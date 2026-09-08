/**
 * Meta Utility template names from docs/WHATSAPP_CLOUD_API_TEMPLATES.md
 * Template 5 (payment_due_customer) intentionally unused.
 */

export const WA = {
  TICKET_CREATED_CUSTOMER: "ticket_created_customer",
  TICKET_ASSIGNED_ENGINEER: "ticket_assigned_engineer",
  TICKET_STATUS_UPDATE: "ticket_status_update",
  TICKET_COMPLETED_CUSTOMER: "ticket_completed_customer",
  // payment_due_customer — skipped by product choice
  PAYMENT_RECEIVED_CUSTOMER: "payment_received_customer",
  SALE_ENQUIRY_RECEIVED: "sale_enquiry_received",
  DEMO_DC_CUSTOMER: "demo_dc_customer",
  PROFORMA_READY_CUSTOMER: "proforma_ready_customer",
  SALE_ORDER_CONFIRMED: "sale_order_confirmed",
} as const;

export type WaTemplateName = (typeof WA)[keyof typeof WA];

export function waText(v: unknown, fallback = "—") {
  const s = String(v ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 1024);
  return s || fallback;
}

export function ticketLabel(ticketNo: number | string) {
  return `SVC-${String(ticketNo).padStart(5, "0")}`;
}

export function inrAmount(amount: number) {
  const n = Number.isFinite(amount) ? amount : 0;
  return `INR ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n)}`;
}

export function statusLabel(status: string) {
  const map: Record<string, string> = {
    OPEN: "Open",
    IN_PROGRESS: "In progress",
    PENDING: "Pending",
    RESOLVED: "Resolved",
    CLOSED: "Completed",
    CANCELLED: "Cancelled",
  };
  return map[status] || status.replace(/_/g, " ");
}

export function formatAddress(parts: Array<string | null | undefined>) {
  return waText(parts.filter(Boolean).join(", "), "—");
}

/** Env override still supported; default = approved Meta template name. */
export function templateName(key: keyof typeof WA, envKey?: string) {
  const fromEnv = envKey ? process.env[envKey]?.trim() : "";
  return fromEnv || WA[key];
}
