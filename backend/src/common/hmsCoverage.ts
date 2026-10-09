/** HMS machine coverage: GC (1yr on HMS sales) → NGC → AMC (weighing only, 1yr renewable). */

export type ServicePlanCode = "GC" | "NGC" | "AMC" | "NON_AMC";

export function normalizeServicePlan(raw: string | null | undefined): ServicePlanCode {
  if (!raw) return "NON_AMC";
  const t = raw.trim().toUpperCase().replace(/\s+/g, "_");
  if (t === "GC" || /guarantee|warranty|new.?machine/i.test(raw)) return "GC";
  if (t === "NGC" || /non.?guarantee|after.?gc|post.?warranty/i.test(raw)) return "NGC";
  if (t === "AMC" || /under.?amc|with.?amc/i.test(raw)) return "AMC";
  if (t === "NON_AMC" || /non.?amc|no.?amc/i.test(raw)) return "NON_AMC";
  return "NON_AMC";
}

export function addMonths(isoDate: string | Date, months: number): Date {
  const d =
    typeof isoDate === "string"
      ? new Date(isoDate.slice(0, 10) + "T12:00:00")
      : new Date(isoDate);
  d.setMonth(d.getMonth() + months);
  return d;
}

export function isDateOnOrAfter(iso: Date | string | null | undefined, today = new Date()): boolean {
  if (!iso) return false;
  const d = iso instanceof Date ? new Date(iso) : new Date(String(iso).slice(0, 10) + "T23:59:59");
  return !Number.isNaN(d.getTime()) && d.getTime() >= today.getTime();
}

export function isUnderGc(opts: {
  servicePlan?: string | null;
  warrantyEndDate?: Date | string | null;
}): boolean {
  if (normalizeServicePlan(opts.servicePlan) !== "GC") return false;
  return isDateOnOrAfter(opts.warrantyEndDate);
}

export function isAmcActive(opts: {
  servicePlan?: string | null;
  amcEndDate?: Date | string | null;
}): boolean {
  if (normalizeServicePlan(opts.servicePlan) !== "AMC") return false;
  if (!opts.amcEndDate) return true;
  return isDateOnOrAfter(opts.amcEndDate);
}

export function isWeighingMachine(machineType?: string | null): boolean {
  return String(machineType ?? "").toUpperCase() === "WEIGHING";
}

/** GC year is over — persist as NGC. Requires a warranty end date in the past. */
export function shouldLapseGcToNgc(opts: {
  servicePlan?: string | null;
  warrantyEndDate?: Date | string | null;
}): boolean {
  if (normalizeServicePlan(opts.servicePlan) !== "GC") return false;
  if (!opts.warrantyEndDate) return false;
  return !isUnderGc(opts);
}

export function effectiveServicePlan(opts: {
  servicePlan?: string | null;
  warrantyEndDate?: Date | string | null;
}): ServicePlanCode {
  if (shouldLapseGcToNgc(opts)) return "NGC";
  const plan = normalizeServicePlan(opts.servicePlan);
  return plan === "NON_AMC" ? "NGC" : plan;
}

/**
 * AMC is weighing-only.
 * After the 1-year GC on an HMS sale, or any existing / outside weighing unit.
 */
export function canEnrollAmc(opts: {
  machineType?: string | null;
  servicePlan?: string | null;
  warrantyEndDate?: Date | string | null;
  amcEndDate?: Date | string | null;
}): { ok: boolean; reason: string } {
  if (!isWeighingMachine(opts.machineType)) {
    return {
      ok: false,
      reason: "AMC is only for weighing machines (billing / CCTV / other stay GC → NGC).",
    };
  }
  const plan = normalizeServicePlan(opts.servicePlan);
  if (plan === "AMC" && isAmcActive(opts)) {
    return { ok: false, reason: "Already on an active AMC — renew when it ends." };
  }
  if (plan === "GC" && isUnderGc(opts)) {
    return {
      ok: false,
      reason: "Still under 1-year HMS guarantee (GC). Contact for AMC after GC ends.",
    };
  }
  return {
    ok: true,
    reason:
      "Weighing machine — convert to AMC for 1 year (renewable). Service free every 6 months; parts charged.",
  };
}

export type ChargeHints = {
  plan: ServicePlanCode;
  serviceFree: boolean;
  sparesFree: boolean;
  underWarrantyDefault: boolean;
  label: string;
  summary: string;
};

export function coverageChargeHints(opts: {
  servicePlan?: string | null;
  warrantyEndDate?: Date | string | null;
  amcEndDate?: Date | string | null;
}): ChargeHints {
  const plan = normalizeServicePlan(opts.servicePlan);
  if (plan === "GC" && isUnderGc(opts)) {
    return {
      plan,
      serviceFree: true,
      sparesFree: true,
      underWarrantyDefault: true,
      label: "GC",
      summary: "HMS guarantee (1yr, any brand sold by us) — service and parts free",
    };
  }
  if (plan === "AMC" && isAmcActive(opts)) {
    return {
      plan,
      serviceFree: true,
      sparesFree: false,
      underWarrantyDefault: false,
      label: "AMC",
      summary: "AMC weighing — 2 free service visits/year (every 6 months); parts charged · 1yr renewable",
    };
  }
  if (plan === "GC") {
    return {
      plan: "NGC",
      serviceFree: false,
      sparesFree: false,
      underWarrantyDefault: false,
      label: "GC ended → NGC",
      summary: "Guarantee ended → NGC. Weighing machines can enroll AMC.",
    };
  }
  return {
    plan: plan === "AMC" || plan === "NON_AMC" ? "NGC" : plan,
    serviceFree: false,
    sparesFree: false,
    underWarrantyDefault: false,
    label: plan === "AMC" ? "AMC expired" : plan === "NGC" ? "NGC" : "Non-AMC",
    summary: "Spare parts and service are chargeable",
  };
}

export function defaultWarrantyEndFromToday(): Date {
  return addMonths(new Date(), 12);
}

/** HMS stamping calendar: A Jan–Mar · B Apr–Jun · C Jul–Sep · D Oct–Dec */
export type StampQuarter = "A" | "B" | "C" | "D";

export function stampQuarterFromDate(iso?: string | Date | null): StampQuarter {
  const d =
    typeof iso === "string"
      ? new Date(iso.slice(0, 10) + "T12:00:00")
      : iso instanceof Date
        ? iso
        : new Date();
  const m = d.getMonth() + 1;
  if (m <= 3) return "A";
  if (m <= 6) return "B";
  if (m <= 9) return "C";
  return "D";
}

export function stampQuarterMonths(code: StampQuarter): string {
  if (code === "A") return "Jan–Mar";
  if (code === "B") return "Apr–Jun";
  if (code === "C") return "Jul–Sep";
  return "Oct–Dec";
}

export function stampQuarterLabel(code: StampQuarter, year?: number | null): string {
  return year
    ? `Quarter ${code} · ${stampQuarterMonths(code)} ${year}`
    : `Quarter ${code} · ${stampQuarterMonths(code)}`;
}

export function hmsSoldCoverage(soldAt: Date = new Date(), weighing: boolean) {
  const gcEnd = addMonths(soldAt, 12);
  const stampDue = weighing ? addMonths(soldAt, 12) : null;
  const quarter = stampQuarterFromDate(soldAt);
  return {
    servicePlan: "GC" as const,
    warrantyEndDate: gcEnd,
    stampingDate: weighing ? soldAt : null,
    nextDueDate: stampDue,
    stampingQuarter: quarter,
    stampingQuarterYear: (stampDue ?? soldAt).getFullYear(),
  };
}

/** First 7 days of Jan / Apr / Jul / Oct — when HMS starts that quarter's stamp reminders. */
export function openingStampQuarter(now = new Date()): StampQuarter | null {
  if (now.getDate() > 7) return null;
  const m = now.getMonth() + 1;
  if (m === 1) return "A";
  if (m === 4) return "B";
  if (m === 7) return "C";
  if (m === 10) return "D";
  return null;
}

export function defaultAmcEndFromStart(from?: Date | string | null): Date {
  return addMonths(from ?? new Date(), 12);
}

export function defaultNextAmcService(from?: Date | string | null): Date {
  return addMonths(from ?? new Date(), 6);
}
