import { z } from "zod";

export const adjustSchema = z.object({
  body: z.object({
    productId: z.string().min(1).max(36),
    warehouseId: z.string().min(1).max(36),
    quantity: z.coerce.number().refine((v) => v !== 0, "Quantity cannot be zero"),
    movementType: z.enum(["IN", "OUT", "ADJUST", "RETURN"]).default("IN"),
    notes: z
      .string()
      .max(255)
      .optional()
      .transform((v) => {
        const t = (v ?? "").trim();
        return t.length >= 2 ? t : "Stock adjustment";
      }),
    referenceType: z.string().max(64).optional(),
    referenceId: z.string().min(1).max(36).optional(),
  }),
  query: z.any(),
  params: z.any(),
});

const dateStr = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v && String(v).trim() ? String(v).trim().slice(0, 10) : null));

export const addStockUnitSchema = z.object({
  body: z.object({
    productId: z.string().min(1).max(36),
    warehouseId: z.string().min(1).max(36),
    serialNo: z.string().min(1).max(120),
    stampingDate: dateStr,
    notes: z.string().max(2000).nullable().optional(),
  }),
  query: z.any(),
  params: z.any(),
});

export const receiveBatchSchema = z.object({
  body: z.object({
    productId: z.string().min(1).max(36),
    warehouseId: z.string().min(1).max(36),
    vendorId: z.string().min(1).max(36).nullable().optional(),
    brandId: z.string().min(1).max(36).nullable().optional(),
    spec: z.string().max(255).nullable().optional(),
    quantity: z.coerce.number().int().min(1).max(200),
    unitAmount: z.coerce.number().min(0).nullable().optional(),
    invoiceNo: z.string().max(64).nullable().optional(),
    invoiceDate: dateStr,
    receivedDate: dateStr,
    notes: z.string().max(2000).nullable().optional(),
    stampingDate: dateStr,
    startSerial: z.string().max(120).nullable().optional(),
    units: z
      .array(
        z.object({
          /** Optional for weighing — server fills from HMS Unique ID */
          serialNo: z.string().max(120).optional().default(""),
          hmsUniqId: z.string().max(40).nullable().optional(),
        }),
      )
      .max(200)
      .nullable()
      .optional(),
  }),
  query: z.any(),
  params: z.any(),
});

export const previewUniqSchema = z.object({
  body: z.object({
    productId: z.string().min(1).max(36),
    quantity: z.coerce.number().int().min(1).max(200),
  }),
  query: z.any(),
  params: z.any(),
});

export const createBrandSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(120),
    code: z.string().max(32).nullable().optional(),
  }),
  query: z.any(),
  params: z.any(),
});

export const updateBrandSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(120).optional(),
    code: z.string().max(32).nullable().optional(),
    isActive: z.boolean().optional(),
  }),
  query: z.any(),
  params: z.object({ id: z.string().min(1).max(36) }),
});

const demoPlacementSchema = z.object({
  customerName: z.string().min(1).max(120),
  customerPhone: z.string().max(32).nullable().optional(),
  customerEmail: z.string().max(191).nullable().optional(),
  customerCompany: z.string().max(191).nullable().optional(),
  customerAddress: z.string().max(512).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  state: z.string().max(100).nullable().optional(),
  assigneeUserId: z.string().min(1).max(36),
  notes: z.string().max(2000).nullable().optional(),
});

const rentalPlacementSchema = z.object({
  customerName: z.string().min(1).max(160),
  customerPhone: z.string().max(32).nullable().optional(),
  customerEmail: z.string().max(191).nullable().optional(),
  customerCompany: z.string().max(191).nullable().optional(),
  customerAddress: z.string().max(512).nullable().optional(),
  city: z.string().max(80).nullable().optional(),
  state: z.string().max(80).nullable().optional(),
  contactId: z.string().min(1).max(36).nullable().optional(),
  startAt: z.string().min(1).max(40),
  expectedReturnAt: z.string().max(40).nullable().optional(),
  dailyRate: z.coerce.number().min(0).nullable().optional(),
  totalAmount: z.coerce.number().min(0).nullable().optional(),
  depositAmount: z.coerce.number().min(0).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const updateStockUnitSchema = z.object({
  body: z.object({
    warehouseId: z.string().min(1).max(36).optional(),
    serialNo: z.string().min(1).max(120).optional(),
    hmsUniqId: z.string().max(40).nullable().optional(),
    brandId: z.string().min(1).max(36).nullable().optional(),
    unitCost: z.coerce.number().min(0).nullable().optional(),
    stampingDate: dateStr,
    notes: z.string().max(2000).nullable().optional(),
    /** STOCK = keep/return to warehouse; DEMO / RENTAL = place out with details */
    placement: z.enum(["STOCK", "DEMO", "RENTAL"]).optional(),
    demo: demoPlacementSchema.optional(),
    rental: rentalPlacementSchema.optional(),
  }),
  query: z.any(),
  params: z.object({ id: z.string().min(1).max(36) }),
});

export const idSchema = z.object({
  body: z.any(),
  query: z.any(),
  params: z.object({ id: z.string().min(1).max(36) }),
});

export const returnDemoSchema = z.object({
  body: z.object({
    notes: z.string().max(500).optional(),
    /** When set, runs full sale-enquiry close (convert or not interested). */
    outcome: z.enum(["NOT_INTERESTED", "READY_TO_BUY"]).optional(),
    stageId: z.string().min(1).max(36).optional(),
    sendWhatsApp: z.boolean().optional(),
  }),
  query: z.any(),
  params: z.object({ id: z.string().min(1).max(36) }),
});

export const stampUnitSchema = z.object({
  body: z.object({
    stampingDate: z.string().min(1).max(32),
    notes: z.string().max(500).optional(),
  }),
  query: z.any(),
  params: z.object({ id: z.string().min(1).max(36) }),
});

export const reduceUnitSchema = z.object({
  body: z.object({
    notes: z.string().max(2000).optional().nullable(),
    /** Reduce reason (stored on unit + movement). */
    reason: z.string().max(2000).optional().nullable(),
    /**
     * SALE → permanent stock-out (SOLD).
     * DEMO → taken to customer site for demo (status DEMO, still trackable / returnable).
     */
    purpose: z.enum(["SALE", "DEMO"]).optional().nullable(),
    /** Service engineer / person the unit was issued to (optional for warehouse sale/demo). */
    issuedToUserId: z.string().uuid().optional().nullable(),
    /** Customer mapped on demo (required in UI) or sale. */
    contactId: z.string().min(1).max(36).optional().nullable(),
  }),
  query: z.any(),
  params: z.object({ id: z.string().min(1).max(36) }),
});

export const issueDemoSchema = z.object({
  body: z.object({
    stockUnitId: z.string().min(1).max(36),
  }),
  query: z.any(),
  params: z.object({ id: z.string().min(1).max(36) }),
});

const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .transform((v) => v.slice(0, 10));

/** Date-range stock-in report for Excel / PDF download */
export const stockExportSchema = z.object({
  body: z.any(),
  query: z.object({
    from: ymd,
    to: ymd,
    warehouseId: z.string().min(1).max(36).optional(),
    productId: z.string().min(1).max(36).optional(),
  }),
  params: z.any(),
});

export const stockImportSchema = z.object({
  body: z.object({
    kind: z.enum(["machines", "sparesBilling", "sparesWeighing"]),
    rows: z.array(z.record(z.unknown())).min(1).max(2000),
  }),
  query: z.any(),
  params: z.any(),
});
