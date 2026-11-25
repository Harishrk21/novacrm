/**
 * Month-end stock count — HMS staff count the godown, NovaCRM compares with what it expected.
 *
 * Spares (counted by quantity): the counted number is entered per spare; any difference is booked as a
 * "stock count" entry on the count date, with a reason (damaged, missing, wrong issue…), so the closing
 * stock equals what was counted. These entries are kept apart from purchases / issues in the register.
 *
 * Machines (one unit = one HMS ID): staff scan or type the HMS IDs (or serials) they find. The result:
 * found · not found (in stock in NovaCRM but not seen) · not expected (seen, but NovaCRM says sold / on
 * demo / unknown). Saving marks each unit with the date and result of its last count.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { newId } from "../../common/utils/id.js";
import { AppError } from "../../common/errors.js";
import { balancesOf } from "../spareStock/spareStock.service.js";

const cf = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** End of the count day in India; adjustments are dated one second before it */
function countMoment(day?: string | null) {
  const d = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const end = new Date(`${d}T23:59:59.999+05:30`);
  if (Number.isNaN(end.getTime())) throw new AppError("Bad count date", 422);
  return { day: d, end, at: new Date(end.getTime() - 1000) };
}

/* ───────────── spares ───────────── */

export async function sparesSheet(t: string, day?: string | null) {
  const { day: d, end } = countMoment(day);
  const items = await prisma.sparePartItem.findMany({
    where: { tenantId: t, deletedAt: null, isActive: true },
    select: { id: true, name: true, partCode: true, machineFamily: true, customFields: true },
  });
  const bal = items.length ? await balancesOf(t, items.map((i) => i.id), new Date(end.getTime() + 1)) : {};
  const rows = items
    .map((i) => ({
      id: i.id,
      spareId: i.partCode ?? "",
      name: i.name,
      group: String(cf(i.customFields).group ?? ""),
      family: i.machineFamily,
      system: Number((bal as Record<string, number>)[i.id] ?? 0),
    }))
    .sort((a, b) => (a.spareId || "ZZ").localeCompare(b.spareId || "ZZ", undefined, { numeric: true }) || a.name.localeCompare(b.name));
  return { date: d, rows };
}

export async function saveSpareCount(
  t: string,
  userId: string,
  body: { date?: string | null; note?: string | null; items: Array<{ sparePartId: string; counted: number; reason?: string | null }> },
) {
  const { day, end, at } = countMoment(body.date);
  if (end.getTime() > Date.now() + 86400000) throw new AppError("The count date can't be in the future", 422);
  const ids = [...new Set(body.items.map((i) => i.sparePartId))];
  const items = await prisma.sparePartItem.findMany({
    where: { tenantId: t, deletedAt: null, id: { in: ids } },
    select: { id: true, name: true, partCode: true },
  });
  if (items.length !== ids.length) throw new AppError("Some spares were not found", 404);
  const byId = new Map(items.map((i) => [i.id, i]));
  const bal = (await balancesOf(t, ids, new Date(end.getTime() + 1))) as Record<string, number>;
  const countId = newId();
  const diffs: Array<{ spareId: string; name: string; system: number; counted: number; diff: number; reason: string | null }> = [];
  const txns: Prisma.SpareStockTxnCreateManyInput[] = [];
  for (const it of body.items) {
    const counted = Math.max(0, Math.round(Number(it.counted) * 1000) / 1000);
    const system = Number(bal[it.sparePartId] ?? 0);
    const diff = Math.round((counted - system) * 1000) / 1000;
    const part = byId.get(it.sparePartId)!;
    if (diff === 0) continue;
    const reason = it.reason?.trim() || null;
    diffs.push({ spareId: part.partCode ?? "", name: part.name, system, counted, diff, reason });
    txns.push({
      id: newId(),
      tenantId: t,
      sparePartId: it.sparePartId,
      txnType: diff > 0 ? "IN" : "OUT",
      quantity: Math.abs(diff),
      txnDate: at,
      supplierName: diff > 0 ? "Stock count" : null,
      notes: `Stock count ${day}: system ${system}, counted ${counted}${reason ? ` — ${reason}` : ""}`.slice(0, 500),
      createdById: userId,
      customFields: { stockCount: true, countId, system, counted, reason },
    });
  }
  if (txns.length) await prisma.spareStockTxn.createMany({ data: txns });
  const summary = {
    countId,
    kind: "SPARES" as const,
    date: day,
    counted: body.items.length,
    matched: body.items.length - diffs.length,
    differences: diffs,
    note: body.note?.trim() || null,
  };
  await prisma.auditLog.create({
    data: {
      id: newId(),
      tenantId: t,
      actorType: "USER",
      actorId: userId,
      action: "stock.count.spares",
      entityType: "stock_count",
      entityId: countId,
      afterJson: summary as unknown as Prisma.InputJsonValue,
    },
  });
  return summary;
}

/* ───────────── machines ───────────── */

const norm = (s: string) => s.toUpperCase().replace(/\s+/g, "");

export async function checkMachines(t: string, body: { warehouseId?: string | null; ids: string[] }) {
  const seen = [...new Set(body.ids.map(norm).filter(Boolean))];
  const [expected, matches, products, warehouses] = await Promise.all([
    prisma.stockUnit.findMany({
      where: { tenantId: t, deletedAt: null, status: "IN_STOCK", ...(body.warehouseId ? { warehouseId: body.warehouseId } : {}) },
      select: { id: true, hmsUniqId: true, serialNo: true, productId: true, warehouseId: true, customFields: true },
    }),
    seen.length
      ? prisma.stockUnit.findMany({
          where: { tenantId: t, deletedAt: null, OR: [{ hmsUniqId: { in: seen } }, { serialNo: { in: seen } }] },
          select: { id: true, hmsUniqId: true, serialNo: true, status: true, productId: true, warehouseId: true, contactId: true },
        })
      : Promise.resolve([]),
    prisma.product.findMany({ where: { tenantId: t }, select: { id: true, name: true, sku: true } }),
    prisma.warehouse.findMany({ where: { tenantId: t }, select: { id: true, name: true } }),
  ]);
  const pn = new Map(products.map((p) => [p.id, p]));
  const wn = new Map(warehouses.map((w) => [w.id, w.name]));
  const unitOf = (id: string) =>
    matches.find((u) => norm(u.hmsUniqId ?? "") === id) ?? matches.find((u) => norm(u.serialNo) === id) ?? null;
  const expectedIds = new Set(expected.map((u) => u.id));
  const foundIds = new Set<string>();
  const notExpected: Array<{ written: string; hmsId: string | null; product: string | null; status: string; where: string | null }> = [];
  for (const id of seen) {
    const u = unitOf(id);
    if (u && expectedIds.has(u.id)) foundIds.add(u.id);
    else
      notExpected.push({
        written: id,
        hmsId: u?.hmsUniqId ?? null,
        product: u ? `${pn.get(u.productId)?.sku ?? ""} ${pn.get(u.productId)?.name ?? ""}`.trim() : null,
        status: u ? (u.status === "IN_STOCK" ? `In stock at ${wn.get(u.warehouseId) ?? "another godown"}` : u.status.replace("_", " ").toLowerCase()) : "not in NovaCRM",
        where: u ? wn.get(u.warehouseId) ?? null : null,
      });
  }
  const line = (u: (typeof expected)[number]) => ({
    unitId: u.id,
    hmsId: u.hmsUniqId,
    serialNo: u.serialNo,
    productId: pn.get(u.productId)?.sku ?? "",
    product: pn.get(u.productId)?.name ?? "",
    warehouse: wn.get(u.warehouseId) ?? "",
  });
  const found = expected.filter((u) => foundIds.has(u.id)).map(line);
  const missing = expected.filter((u) => !foundIds.has(u.id)).map(line);
  // per product: expected / found
  const byProduct = new Map<string, { productId: string; product: string; expected: number; found: number }>();
  for (const u of expected) {
    const k = u.productId;
    const row = byProduct.get(k) ?? { productId: pn.get(k)?.sku ?? "", product: pn.get(k)?.name ?? "", expected: 0, found: 0 };
    row.expected += 1;
    if (foundIds.has(u.id)) row.found += 1;
    byProduct.set(k, row);
  }
  return {
    expected: expected.length,
    found,
    missing,
    notExpected,
    products: [...byProduct.values()].sort((a, b) => a.productId.localeCompare(b.productId, undefined, { numeric: true })),
  };
}

export async function saveMachineCount(
  t: string,
  userId: string,
  body: { date?: string | null; warehouseId?: string | null; ids: string[]; note?: string | null },
) {
  const { day } = countMoment(body.date);
  const r = await checkMachines(t, body);
  const countId = newId();
  const mark = async (unitIds: string[], result: "FOUND" | "NOT_FOUND") => {
    if (!unitIds.length) return;
    const units = await prisma.stockUnit.findMany({ where: { id: { in: unitIds } }, select: { id: true, customFields: true } });
    const ups = units.map((u) =>
      prisma.stockUnit.update({
        where: { id: u.id },
        data: { customFields: { ...cf(u.customFields), lastCount: { date: day, result, countId } } as Prisma.InputJsonValue },
      }),
    );
    for (let i = 0; i < ups.length; i += 25) await Promise.all(ups.slice(i, i + 25));
  };
  await mark(r.found.map((x) => x.unitId), "FOUND");
  await mark(r.missing.map((x) => x.unitId), "NOT_FOUND");
  const summary = {
    countId,
    kind: "MACHINES" as const,
    date: day,
    expected: r.expected,
    found: r.found.length,
    missing: r.missing.map((m) => ({ hmsId: m.hmsId, productId: m.productId, product: m.product })),
    notExpected: r.notExpected,
    note: body.note?.trim() || null,
  };
  await prisma.auditLog.create({
    data: {
      id: newId(),
      tenantId: t,
      actorType: "USER",
      actorId: userId,
      action: "stock.count.machines",
      entityType: "stock_count",
      entityId: countId,
      afterJson: summary as unknown as Prisma.InputJsonValue,
    },
  });
  return summary;
}

/* ───────────── history ───────────── */

export async function history(t: string) {
  const logs = await prisma.auditLog.findMany({
    where: { tenantId: t, action: { startsWith: "stock.count." } },
    orderBy: { createdAt: "desc" },
    take: 24,
  });
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(logs.map((l) => l.actorId).filter(Boolean) as string[])] } },
    select: { id: true, name: true },
  });
  const un = new Map(users.map((u) => [u.id, u.name]));
  return logs.map((l) => ({ ...cf(l.afterJson), at: l.createdAt, by: l.actorId ? un.get(l.actorId) ?? "" : "" }));
}
