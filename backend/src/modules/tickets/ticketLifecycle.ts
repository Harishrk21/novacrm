import { AppError } from "../../common/errors.js";

export type TicketStatusName = "OPEN" | "IN_PROGRESS" | "PENDING" | "RESOLVED" | "CLOSED";

/** Allowed forward / limited reopen transitions (no arbitrary jumps). */
const ALLOWED: Record<TicketStatusName, TicketStatusName[]> = {
  /** Must assign / start before Mark complete — cannot skip to RESOLVED from OPEN. */
  OPEN: ["IN_PROGRESS", "PENDING"],
  IN_PROGRESS: ["PENDING", "OPEN", "RESOLVED"],
  PENDING: ["IN_PROGRESS", "OPEN", "RESOLVED"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: ["IN_PROGRESS"],
};

export function assertStatusTransition(
  from: string,
  to: string,
  opts: { assignedToId?: string | null; isAdmin?: boolean },
) {
  if (from === to) return;
  const allowed = ALLOWED[from as TicketStatusName];
  if (!allowed?.includes(to as TicketStatusName)) {
    throw new AppError(
      `Invalid status change ${from} → ${to}. Allowed: ${(allowed ?? []).join(", ") || "none"}`,
      400,
    );
  }
  if (to === "RESOLVED" && !opts.assignedToId) {
    throw new AppError("Assign an engineer before marking the service complete", 400);
  }
  if (to === "CLOSED" && from !== "RESOLVED") {
    throw new AppError("Approve & close only after the engineer marks the job complete (RESOLVED)", 400);
  }
  if (to === "CLOSED" && !opts.isAdmin) {
    throw new AppError("Only admin can approve and close completed service", 403);
  }
  if (from === "CLOSED" && to === "IN_PROGRESS" && !opts.isAdmin) {
    throw new AppError("Only admin can reopen a closed ticket", 403);
  }
}

/** Zero-charge AMC / free jobs may close without a cash collection. */
export function isFreeJob(paymentTotal: number, advanceAmount: number) {
  return paymentTotal <= 0 && advanceAmount <= 0;
}

export function assertCanClosePayment(opts: {
  paymentStatus: string;
  paymentTotal: number;
  advanceAmount: number;
}) {
  if (isFreeJob(opts.paymentTotal, opts.advanceAmount)) return;
  if (opts.paymentStatus !== "PAID") {
    throw new AppError(
      "Mark the job paid (with payment method / proof) before approving & closing",
      400,
    );
  }
}

export function assertCanInvoice(opts: { status: string; paymentTotal: number; advanceAmount: number }) {
  if (opts.status !== "RESOLVED" && opts.status !== "CLOSED") {
    throw new AppError("Create a service invoice only after the job is marked complete (RESOLVED)", 400);
  }
  if (opts.paymentTotal <= 0 && opts.advanceAmount <= 0) {
    throw new AppError("Set payment amounts before creating an invoice", 400);
  }
}

const ONLINE_METHODS = new Set(["UPI", "NEFT", "RTGS", "CARD"]);

export function assertPaymentCollection(opts: {
  paymentMethod?: string | null;
  paymentReference?: string | null;
  paymentProofUrl?: string | null;
  paymentTotal: number;
}) {
  if (opts.paymentTotal <= 0) {
    throw new AppError(
      "Enter Total payment (₹) before marking paid — or close as a free job if there is no charge",
      400,
    );
  }
  if (!opts.paymentMethod) {
    throw new AppError("Select payment method (Cash / UPI / NEFT / …)", 400);
  }
  if (ONLINE_METHODS.has(opts.paymentMethod)) {
    if (!opts.paymentReference?.trim()) {
      throw new AppError("Enter UTR / transaction reference for online / bank payment", 400);
    }
    if (!opts.paymentProofUrl?.trim()) {
      throw new AppError("Upload payment proof (screenshot / receipt) for online / bank payment", 400);
    }
  }
  if (opts.paymentMethod === "CHEQUE" && !opts.paymentReference?.trim()) {
    throw new AppError("Enter cheque number as payment reference", 400);
  }
}

export function ticketCf(obj: unknown): Record<string, unknown> {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj as Record<string, unknown>;
  return {};
}
