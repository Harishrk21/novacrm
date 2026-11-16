import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.middleware.js";
import { requireTenant } from "../../middleware/tenant.middleware.js";
import { requirePermission } from "../../middleware/permissions.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { success } from "../../common/utils/response.js";
import { prisma } from "../../config/database.js";
import { writeAudit } from "../../common/audit.js";

/**
 * Field tracking for engineers who visit 2–3 customers a day.
 * A phone web app can't track in the background, so the location is sent while the app is open
 * (every few minutes) and on every job action — Accept, Check in at site, Start, Work report, Complete.
 * Owner / admin see each engineer's last location and whether they were at the customer's place.
 */
export const fieldRouter = Router();
fieldRouter.use(authenticate, requireTenant);

/** Within this many metres of the customer's pin counts as "at the customer". */
const AT_SITE_M = 300;
const EVENTS = ["PING", "ACCEPT", "CHECK_IN", "START", "REPORT", "COMPLETE"] as const;
type Row = Record<string, unknown>;
const obj = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});

export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
/** Customer pin stored as "lat,lng" (or a maps URL containing it) in customFields.gps_location */
export function parsePin(v: unknown): { lat: number; lng: number } | null {
  const m = /(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/.exec(String(v ?? ""));
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

const pingSchema = z.object({
  body: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy: z.number().nonnegative().max(100000).optional().nullable(),
    event: z.enum(EVENTS).default("PING"),
    ticketId: z.string().min(1).max(36).optional().nullable(),
  }),
  query: z.any(),
  params: z.any(),
});

fieldRouter.post("/location", validate(pingSchema), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const userId = q.auth!.userId!;
  const d = q.body as z.infer<typeof pingSchema>["body"];
  const at = new Date();
  const here = { lat: d.lat, lng: d.lng };

  let job: Row | null = null;
  let distance: number | null = null;
  let pinnedNow = false;
  if (d.ticketId) {
    const ticket = await prisma.ticket.findFirst({
      where: { id: d.ticketId, tenantId: t, deletedAt: null },
      select: { id: true, ticketNo: true, contactId: true, customFields: true },
    });
    if (ticket?.contactId) {
      const contact = await prisma.contact.findFirst({
        where: { id: ticket.contactId, tenantId: t, deletedAt: null },
        select: { id: true, name: true, customFields: true },
      });
      if (contact) {
        const ccf = obj(contact.customFields);
        const pin = parsePin(ccf.gps_location);
        if (pin) distance = distanceM(here, pin);
        else if (d.event === "CHECK_IN" && (d.accuracy ?? 9999) <= 150) {
          // First visit with a good GPS fix pins the customer's location for next time
          await prisma.contact.update({
            where: { id: contact.id },
            data: {
              customFields: {
                ...ccf,
                gps_location: `${d.lat.toFixed(6)},${d.lng.toFixed(6)}`,
                gpsPinnedAt: at.toISOString(),
                gpsPinnedFrom: "engineer check-in",
              } as never,
            },
          });
          pinnedNow = true;
          distance = 0;
        }
        job = { id: ticket.id, ticketNo: ticket.ticketNo, customer: contact.name };
      }
      // Keep the visit on the job itself (shown on the job + customer page)
      if (d.event !== "PING") {
        const tcf = obj(ticket.customFields);
        const visits = Array.isArray(tcf.siteVisits) ? (tcf.siteVisits as Row[]) : [];
        await prisma.ticket.update({
          where: { id: ticket.id },
          data: {
            customFields: {
              ...tcf,
              siteVisits: [
                ...visits,
                {
                  event: d.event,
                  at: at.toISOString(),
                  lat: d.lat,
                  lng: d.lng,
                  accuracy: d.accuracy ?? null,
                  distanceM: distance,
                  atSite: distance == null ? null : distance <= AT_SITE_M,
                  byUserId: userId,
                },
              ].slice(-40),
            } as never,
          },
        });
      }
    }
  }

  const user = await prisma.user.findFirst({ where: { id: userId, tenantId: t }, select: { preferences: true } });
  const prefs = obj(user?.preferences);
  await prisma.user.update({
    where: { id: userId },
    data: {
      preferences: {
        ...prefs,
        lastLocation: {
          lat: d.lat,
          lng: d.lng,
          accuracy: d.accuracy ?? null,
          at: at.toISOString(),
          event: d.event,
          ticketId: d.ticketId ?? null,
          distanceM: distance,
        },
      } as never,
    },
  });
  const jobRef = job ? `SVC-${String(job.ticketNo).padStart(5, "0")} · ${String(job.customer)}` : "";
  await writeAudit({
    tenantId: t,
    actorType: "USER",
    actorId: userId,
    action: `field.${d.event.toLowerCase()}`,
    entityType: d.ticketId ? "Ticket" : "User",
    entityId: d.ticketId ?? userId,
    afterJson: {
      // site check-in / complete show in Reports → History; routine pings stay out (no "area")
      ...(d.event === "CHECK_IN" || d.event === "COMPLETE"
        ? {
            area: "Service",
            label: jobRef,
            summary: `${d.event === "CHECK_IN" ? "Checked in" : "Completed"} ${
              distance == null ? "(customer location not pinned yet)" : distance <= AT_SITE_M ? `at the customer (${distance} m)` : `${(distance / 1000).toFixed(1)} km away from the customer`
            }${pinnedNow ? " — customer location saved" : ""}`,
          }
        : {}),
      lat: d.lat,
      lng: d.lng,
      accuracy: d.accuracy ?? null,
      event: d.event,
      ticketId: d.ticketId ?? null,
      distanceM: distance,
    },
  } as never);
  return success(r, {
    ok: true,
    distanceM: distance,
    atSite: distance == null ? null : distance <= AT_SITE_M,
    pinnedCustomer: pinnedNow,
  });
});

/** Owner / admin: every engineer's last location, current job, at-site check and today's visits. */
fieldRouter.get("/engineers", requirePermission("field:track"), async (q: Request, r: Response) => {
  const t = q.auth!.tenantId!;
  const role = await prisma.role.findFirst({ where: { tenantId: t, code: "SERVICE_ENGINEER", deletedAt: null }, select: { id: true } });
  const engineers = role
    ? await prisma.user.findMany({
        where: { tenantId: t, roleId: role.id, deletedAt: null, status: "ACTIVE" },
        select: { id: true, name: true, phone: true, avatarUrl: true, preferences: true },
        orderBy: { name: "asc" },
      })
    : [];
  const ids = engineers.map((e) => e.id);
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const [jobs, events] = await Promise.all([
    ids.length
      ? prisma.ticket.findMany({
          where: { tenantId: t, deletedAt: null, assignedToId: { in: ids }, status: { in: ["OPEN", "IN_PROGRESS", "PENDING"] } },
          select: { id: true, ticketNo: true, status: true, subject: true, assignedToId: true, contactId: true, updatedAt: true },
          orderBy: { updatedAt: "desc" },
        })
      : Promise.resolve([]),
    ids.length
      ? prisma.auditLog.findMany({
          where: { tenantId: t, actorId: { in: ids }, action: { startsWith: "field." }, createdAt: { gte: dayStart } },
          orderBy: { createdAt: "asc" },
          select: { actorId: true, action: true, createdAt: true, afterJson: true },
        })
      : Promise.resolve([]),
  ]);
  const contactIds = [...new Set(jobs.map((j) => j.contactId).filter(Boolean) as string[])];
  const eventTicketIds = [...new Set(events.map((e) => String(obj(e.afterJson).ticketId ?? "")).filter(Boolean))];
  const [contacts, evTickets] = await Promise.all([
    contactIds.length
      ? prisma.contact.findMany({
          where: { tenantId: t, id: { in: contactIds } },
          select: { id: true, name: true, area: true, customFields: true },
        })
      : Promise.resolve([]),
    eventTicketIds.length
      ? prisma.ticket.findMany({ where: { tenantId: t, id: { in: eventTicketIds } }, select: { id: true, ticketNo: true, contactId: true } })
      : Promise.resolve([]),
  ]);
  const evContactIds = [...new Set(evTickets.map((x) => x.contactId).filter(Boolean) as string[])].filter((id) => !contactIds.includes(id));
  const moreContacts = evContactIds.length
    ? await prisma.contact.findMany({ where: { tenantId: t, id: { in: evContactIds } }, select: { id: true, name: true, area: true, customFields: true } })
    : [];
  const cMap = new Map([...contacts, ...moreContacts].map((c) => [c.id, c]));
  const tMap = new Map(evTickets.map((x) => [x.id, x]));

  const items = engineers.map((e) => {
    const last = obj(obj(e.preferences).lastLocation);
    const lastAt = last.at ? String(last.at) : null;
    const here = last.lat != null ? { lat: Number(last.lat), lng: Number(last.lng) } : null;
    const myJobs = jobs.filter((j) => j.assignedToId === e.id);
    const current = myJobs.find((j) => j.status === "IN_PROGRESS") ?? myJobs[0] ?? null;
    const cc = current?.contactId ? cMap.get(current.contactId) : null;
    const pin = cc ? parsePin(obj(cc.customFields).gps_location) : null;
    const distToJob = here && pin ? distanceM(here, pin) : null;
    const today = events
      .filter((ev) => ev.actorId === e.id && ev.action !== "field.ping")
      .map((ev) => {
        const a = obj(ev.afterJson);
        const tk = a.ticketId ? tMap.get(String(a.ticketId)) : null;
        const c = tk?.contactId ? cMap.get(tk.contactId) : null;
        return {
          at: ev.createdAt,
          event: String(a.event ?? ev.action.replace("field.", "").toUpperCase()),
          job: tk ? `SVC-${String(tk.ticketNo).padStart(5, "0")}` : null,
          ticketId: tk?.id ?? null,
          customer: c?.name ?? null,
          distanceM: a.distanceM == null ? null : Number(a.distanceM),
          lat: Number(a.lat),
          lng: Number(a.lng),
        };
      });
    const pings = events.filter((ev) => ev.actorId === e.id).length;
    return {
      id: e.id,
      name: e.name,
      phone: e.phone,
      avatarUrl: e.avatarUrl,
      last: here
        ? { ...here, at: lastAt, accuracy: last.accuracy == null ? null : Number(last.accuracy), event: String(last.event ?? "PING") }
        : null,
      currentJob: current
        ? {
            id: current.id,
            ticketNo: current.ticketNo,
            status: current.status,
            subject: current.subject,
            customer: cc?.name ?? null,
            area: cc?.area ?? null,
            customerPinned: Boolean(pin),
            distanceM: distToJob,
            atSite: distToJob == null ? null : distToJob <= AT_SITE_M,
          }
        : null,
      openJobs: myJobs.length,
      today,
      updatesToday: pings,
    };
  });
  return success(r, { items, atSiteMeters: AT_SITE_M });
});
