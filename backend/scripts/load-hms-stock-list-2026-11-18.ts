/**
 * Make HMS's STOCK DETAILS list (from their stock employee, 2026-11-18) the product list.
 *
 *   npx tsx scripts/load-hms-stock-list-2026-11-18.ts            # dry run — prints every difference
 *   npx tsx scripts/load-hms-stock-list-2026-11-18.ts --apply    # writes (backup first)
 *
 * Each of the 120 models is either
 *   - the SAME as a product already loaded from the IT register → that product is kept (same id, so stock,
 *     customer machines and imports stay linked) and renamed to HMS's own wording, or
 *   - NEW → added.
 * Products that are not on the list are hidden (not deleted) — old registers can still match them.
 * Decisions were made line by line; "same" only where the model really is the same machine.
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/config/database.js";
import { newId } from "../src/common/utils/id.js";

const TENANT = "25393a78-d3d2-483b-b141-3f4345ff4572";
const APPLY = process.argv.includes("--apply");

type Fam = "WEIGHING_SCALES" | "BILLING_MACHINE" | "TOUCH_POS" | "OFFICE_AUTOMATION" | "BILLING_SOFTWARE";
type Item = {
  heading: string; // as written in the stock list
  text: string; // as written in the stock list
  brand: string;
  model: string; // tidied model name (product name = brand + model)
  type: string;
  fam: Fam;
  kind: string;
  same?: string; // name of the product already loaded that is this same model
  suppliers?: string[]; // only when the list itself says who supplies it
};

const POS = (h: string, text: string, brand: string, model: string, same?: string, type = "Touch POS"): Item => ({ heading: h, text, brand, model, type, fam: "TOUCH_POS", kind: "TOUCH_POS", same });
const ACC = (h: string, text: string, brand: string, model: string, type: string, same?: string): Item => ({ heading: h, text, brand, model, type, fam: "TOUCH_POS", kind: "TOUCH_POS", same });
const BILL = (h: string, text: string, brand: string, model: string, type: string, same?: string): Item => ({ heading: h, text, brand, model, type, fam: "BILLING_MACHINE", kind: "BILLING", same });
const SCALE = (h: string, text: string, brand: string, model: string, type: string, same?: string, suppliers?: string[]): Item => ({ heading: h, text, brand, model, type, fam: "WEIGHING_SCALES", kind: "WEIGHING", same, suppliers });

const ITEMS: Item[] = [
  // ── IMIN
  POS("IMIN", "SUNMI D3 PRO TOUCH POS", "Sunmi", "D3 Pro Touch POS", "Nukkad SUNMI D3 Pro"),
  POS("IMIN", "SWIFT 2 HANDY TOUCH POS", "iMin", "Swift 2 Handy Touch POS", "iMin Swift 2"),
  POS("IMIN", "D1 10 INCH TOUCH POS", "iMin", 'D1 10" Touch POS', 'iMin D1 10" Touch POS'),
  POS("IMIN", "SWAN 2 TOUCH POS", "iMin", "Swan 2 Touch POS"),
  POS("IMIN", "SWAN 2 DUAL DISPLAY TOUCH POS", "iMin", "Swan 2 Dual Display Touch POS"),
  POS("IMIN", "SWAN 1 PRO TOUCH POS", "iMin", "Swan 1 Pro Touch POS"),
  // ── NGX
  POS("NGX", "WINOWS I5 5TH GEN TOUCH POS", "NGX", "Windows i5 5th Gen Touch POS", "NGX Winpos"),
  BILL("NGX", "SMART PRO SP 92TB BILLING MACHINE", "NGX", "Smart Pro SP92TB Billing Machine", "Keypad billing machine", "NGX Smart Pro SP92TB"),
  BILL("NGX", "SMART PRO SP 93TB BILLING MACHINE", "NGX", "Smart Pro SP93TB Billing Machine", "Keypad billing machine"),
  // ── TVS
  ACC("TVS", "CASH DRAWER CHAMP CD", "TVS", "Champ CD Cash Drawer", "Cash drawer"),
  BILL("TVS", "HANDY 5.5 INCH / 2 GB HANDY BILLING", "TVS", 'Handy Billing 5.5" 2GB', "Handy billing"),
  ACC("TVS", "3200 LIT THERMAL PRINTER", "TVS", "3200 Lite Thermal Printer", "Receipt printer", "TVS Thermal Printer 3200 Lite"),
  POS("TVS", "TP415 CA TOUCH POS PRIME", "TVS", "TP415 CA Touch POS Prime", "TVS TP 415 C Touch POS Prime"),
  BILL("TVS", "I9200 TOUCH HANDY BILLING", "TVS", "I9200 Touch Handy Billing", "Handy billing"),
  // ── RETSOL
  ACC("RETSOL", "2D HANDY SCANNER BLUTOOTH", "Retsol", "2D Handy Scanner Bluetooth", "Barcode scanner", "Retsol Scanner Bluetooth D5015"),
  ACC("RETSOL", "2D HANDY SCANNER", "Retsol", "2D Handy Scanner", "Barcode scanner", "Retsol 2D Handy Scanner"),
  ACC("RETSOL", "2D FIXED SCANNER SQUAR", "Retsol", "2D Fixed Scanner Square", "Barcode scanner", "Retsol 2D Fixed Scanner Square PD2000"),
  ACC("RETSOL", "PD 400 SCANNER", "Retsol", "PD 400 Scanner", "Barcode scanner"),
  ACC("RETSOL", "THERMAL PRINTER", "Retsol", "Thermal Printer", "Receipt printer", "Retsol Thermal Printer"),
  ACC("RETSOL", "CASH DRAWER", "Retsol", "Cash Drawer", "Cash drawer", "Retsol Cash Drawer"),
  // ── XPRINT
  ACC("XPRINT", "2 INCH HANDY BLUTOOTH PRINTER", "Xprint", '2" Handy Bluetooth Printer', "Receipt printer"),
  ACC("XPRINT", "3 INCH HANDY BLUTOOTH PRINTER", "Xprint", '3" Handy Bluetooth Printer', "Receipt printer"),
  // ── TSC
  ACC("TSC", "BARCODE PRINTER TTP244 PRO", "TSC", "TTP244 Pro Barcode Printer", "Barcode / label printer"),
  ACC("TSC", "BARCODE PRINTER TE244", "TSC", "TE244 Barcode Printer", "Barcode / label printer", "TSC Barcode Printer"),
  ACC("TSC", "BPOS THERMAL PRINTER", "BPOS", "Thermal Printer", "Receipt printer"),
  ACC("TSC", "ZENPERT LABEL PRINTER", "Zenpert", "Label Printer", "Barcode / label printer"),
  // ── SOFTLAND
  BILL("SOFTLAND", "HANDY BILLING PARKING", "Softland", "Handy Billing Parking", "Handy billing", "Softland Handy Billing Parking"),
  BILL("SOFTLAND", "HANDY BILLING BANK", "Softland", "Handy Billing Bank", "Handy billing"),
  BILL("SOFTLAND", "HANDY BILLING GPRS", "Softland", "Handy Billing GPRS", "Handy billing", "Softland Handy Billing GPRS"),
  ACC("SOFTLAND", "WIFI HANDY PRINTER", "Softland", "WiFi Handy Printer", "Receipt printer"),
  // ── SCANGEL
  POS("SCANGEL", "AI TOUCH POS", "Scangel", "AI Touch POS"),
  SCALE("SCANGEL", "TOUCH WEIGHING SCALE", "Scangel", "Touch Weighing Scale", "Label-printing scale"),
  // ── SENSIBLE
  POS("SENSIBLE", "10 PRO TOUCH POS", "Sensible", "10 Pro Touch POS", 'Sensible 10" Touch POS Inbuilt Printer'),
  POS("SENSIBLE", "IMI 2 GB TOUCH POS", "Sensible", "IMI 2GB Touch POS"),
  // ── WEP
  BILL("WEP", "JOY PRO BILLING MACHINE", "WEP", "Joy Pro Billing Machine", "Keypad billing machine", "WEP Joy Pro"),
  BILL("WEP", "JOY PLUS BILLING MACHINE", "WEP", "Joy Plus Billing Machine", "Keypad billing machine"),
  BILL("WEP", "JOY ULTRA PRO BILLING MACHINE", "WEP", "Joy Ultra Pro Billing Machine", "Keypad billing machine", "WEP Joy Ultra Pro"),
  BILL("WEP", "85T PLUS BILLING MACHINE", "WEP", "85T Plus Billing Machine", "Keypad billing machine", "WEP 85T Plus"),
  ACC("WEP", "HOOKS THERMAL PRINTER", "WEP", "Hooks Thermal Printer", "Receipt printer", "WEP Hooks Thermal Printer"),
  ACC("WEP", "HOOKS THERMAL PRINTER BLUTOOTH", "WEP", "Hooks Thermal Printer Bluetooth", "Receipt printer", "WEP Hooks Thermal Printer Bluetooth"),
  ACC("WEP", "HOOKS THERMAL PRINTER WIFI", "WEP", "Hooks Thermal Printer WiFi", "Receipt printer"),
  ACC("WEP", "HOOKS 2D BLUTOOTH SCANNER", "WEP", "Hooks 2D Bluetooth Scanner", "Barcode scanner", "WEP 2D Scanner Wireless Bluetooth"),
  // ── HMS BILLING (HMS brand billing machines)
  BILL("HMS BILLING", "JUNIOR STAR BILLING MACHINE", "HMS", "Junior Star Billing Machine", "Keypad billing machine", "HMS Junior Star"),
  BILL("HMS BILLING", "2T BILLING MACHINE", "HMS", "2T Billing Machine", "Keypad billing machine", "HMS 2T"),
  BILL("HMS BILLING", "3T BILLING MACHINE", "HMS", "3T Billing Machine", "Keypad billing machine", "HMS 3T"),
  BILL("HMS BILLING", "SMART METAL BILLING MACHINE", "HMS", "Smart Metal Billing Machine", "Keypad billing machine", "HMS Smart Metal"),
  BILL("HMS BILLING", "HANDY BILLING MACHINE", "HMS", "Handy Billing Machine", "Handy billing", "HMS Handy Billing GPRS"),
  // ── VANDANA (supplier — HMS-brand scales)
  SCALE("VANDANA", "200 GM POCKET SCALE", "HMS", "200 g Pocket Scale", "Jewellery / precision scale", "HMS 200 g Pocket Scale", ["Vandana"]),
  SCALE("VANDANA", "500 GM NOTE BOOK SCALE", "HMS", "500 g Note Book Scale", "Jewellery / precision scale", "HMS 500 g Scale", ["Vandana"]),
  SCALE("VANDANA", "50 KG LUGGAGE SCALE", "HMS", "50 kg Luggage Scale", "Table-top / counter scale", undefined, ["Vandana"]),
  SCALE("VANDANA", "150 KG GLASS PERSONAL SCALE", "HMS", "150 kg Glass Personal Scale", "Personal / health scale", "HMS 150 kg Personal Scale Glass", ["Vandana"]),
  SCALE("VANDANA", "10 KG MINI SS SCALE", "HMS", "10 kg Mini SS Scale", "Table-top / counter scale", "HMS 10 kg Mini SS", ["Vandana"]),
  // ── SEALING MACHINE
  ...["8", "10", "12"].map((n): Item => ({
    heading: "SEALING MAHCINE", text: `${n} INCH SEALING`, brand: "Generic", model: `${n} inch Sealing Machine`,
    type: "Sealing machine", fam: "OFFICE_AUTOMATION", kind: "OTHER", same: `${n} inch Sealing Machine`,
  })),
  // ── ASK (supplier — LADA counters, shredders)
  { heading: "ASK", text: "LADA LOOSE NOTE COUNTING", brand: "LADA", model: "Loose Note Counting", type: "Note / cash counting machine", fam: "OFFICE_AUTOMATION", kind: "CCM", same: "LADA Loose Note Counting", suppliers: ["ASK"] },
  { heading: "ASK", text: "LADA MULTI CASH COUTING", brand: "LADA", model: "Multi Cash Counting", type: "Note / cash counting machine", fam: "OFFICE_AUTOMATION", kind: "CCM", same: "LADA Multi Cash Counting", suppliers: ["ASK"] },
  { heading: "ASK", text: "LADA MULTI CASH COUTING GOLD", brand: "LADA", model: "Multi Cash Counting Gold", type: "Note / cash counting machine", fam: "OFFICE_AUTOMATION", kind: "CCM", same: "LADA Mixed Value Gold", suppliers: ["ASK"] },
  { heading: "ASK", text: "PAPER SHREDDER CC1012 CD", brand: "Generic", model: "Paper Shredder CC1012 CD", type: "Paper shredder", fam: "OFFICE_AUTOMATION", kind: "OTHER", same: "Paper Shredder", suppliers: ["ASK"] },
  { heading: "ASK", text: "PAPER SHREDDER L100", brand: "Generic", model: "Paper Shredder L100", type: "Paper shredder", fam: "OFFICE_AUTOMATION", kind: "OTHER", suppliers: ["ASK"] },
  // ── PHOENIX
  SCALE("PHOENIX", "150 KG METAL PAS PERSONAL SCALE", "Phoenix", "150 kg Metal PAS Personal Scale", "Personal / health scale", "Phoenix 150 kg PAS Metal Personal Scale"),
  SCALE("PHOENIX", "20 KG NBY20 U BABY SCALE", "Phoenix", "20 kg NBY-20U Baby Scale", "Personal / health scale", "Phoenix NBY-20U"),
  SCALE("PHOENIX", "200 KG PBMI WITH PRINTER", "Phoenix", "200 kg PBMI With Printer", "Personal / health scale", "Phoenix PBMI 200 kg With Printer"),
  SCALE("PHOENIX", "200 KG PBMI WITHOUT PEINTER", "Phoenix", "200 kg PBMI Without Printer", "Personal / health scale"),
  SCALE("PHOENIX", "120 KG 3 IN ONE SCALE", "Phoenix", "120 kg 3 In 1 Scale", "Personal / health scale", "Phoenix 120 kg 3 In 1 Health"),
  // ── WENSAR
  SCALE("WENSAR", "3 KG /0.01 GM PGB3110", "Wensar", "PGB3110 3 kg / 0.01 g", "Jewellery / precision scale"),
  SCALE("WENSAR", "220 GM /0.1 MG KAB5L", "Wensar", "KAB5L 220 g / 0.1 mg", "Jewellery / precision scale"),
  SCALE("WENSAR", "5 TON CARNE SCALE", "Wensar", "5 ton Crane Scale", "Crane scale"),
  SCALE("WENSAR", "10 TON CRANE SCALE", "Wensar", "10 ton Crane Scale", "Crane scale"),
  // ── HMS (weighing)
  SCALE("HMS", "6 KG / 0.1 PEB6084 SINGLE WINDOW", "HMS", "6 kg / 0.1 g PEB6084 Single Window", "Jewellery / precision scale", "HMS 6 kg / 0.1 g PEB6084"),
  SCALE("HMS", "6 KG /100 MG BOSS SERIE 3 WINDOW", "HMS", "6 kg / 100 mg Boss Series 3 Window", "Table-top / counter scale", "HMS 6 kg / 100 mg 3 Window Boss"),
  SCALE("HMS", "6 KG /100 MG AQUA SERIES", "HMS", "6 kg / 100 mg Aqua Series", "Table-top / counter scale", "HMS 6 kg / 100 mg Aqua"),
  SCALE("HMS", "600 GM/10 MG GEM SERIES", "HMS", "600 g / 10 mg Gem Series", "Jewellery / precision scale", "HMS 600 g / 10 mg Gem"),
  SCALE("HMS", "600 GM/10 MG JOHIRI SERIES", "HMS", "600 g / 10 mg Johiri Series", "Jewellery / precision scale", "HMS 600 g / 10 mg Johiri"),
  SCALE("HMS", "600 GM /10 MG BLUTOOTH& RS232", "HMS", "600 g / 10 mg Bluetooth & RS232", "Jewellery / precision scale", "HMS 600 g / 10 mg Bluetooth + RS232"),
  SCALE("HMS", "1 KG /10 MG JEWELLERY SCALE", "HMS", "1 kg / 10 mg Jewellery Scale", "Jewellery / precision scale", "HMS 1 kg / 10 mg Jewellery"),
  SCALE("HMS", "5 KG /0.5 GM 175*225 MM ABS REAR", "HMS", "5 kg / 0.5 g 175*225 mm ABS Rear", "Table-top / counter scale"),
  SCALE("HMS", "20 KG 175*225 MM ABS REAR", "HMS", "20 kg 175*225 mm ABS Rear", "Table-top / counter scale", "HMS 20 kg ABS Rear"),
  SCALE("HMS", "20 KG 175*225 MM ABS POLE", "HMS", "20 kg 175*225 mm ABS Pole", "Table-top / counter scale"),
  SCALE("HMS", "20 KG 175*225 MM TOP SS BOTTOM MS REAR", "HMS", "20 kg 175*225 mm Top SS Bottom MS Rear", "Table-top / counter scale"),
  SCALE("HMS", "30 KG WEIGHING WITH BILLING", "HMS", "30 kg Weighing with Billing", "Label-printing scale", "HMS Q-10 Weighing Billing"),
  SCALE("HMS", "30 KG Q-9 LABEL PRINTER", "HMS", "30 kg Q-9 Label Printer", "Label-printing scale", "HMS 30 kg Q-9 Label Printer"),
  SCALE("HMS", "30 KG 250*300 MM ECO METAL POLE", "HMS", "30 kg 250*300 mm Eco Metal Pole", "Table-top / counter scale", "HMS 30 kg Eco Metal Pole"),
  SCALE("HMS", "30 KG 250*300 MM ECO METAL REAR", "HMS", "30 kg 250*300 mm Eco Metal Rear", "Table-top / counter scale", "HMS 30 kg Eco Metal Rear"),
  SCALE("HMS", "30 KG 250*300 MM ECO METAL REAR RS232", "HMS", "30 kg 250*300 mm Eco Metal Rear RS232", "Table-top / counter scale", "HMS 30 kg Eco Metal Rear RS232"),
  SCALE("HMS", "30 KG 250*300 MM ECO METAL POLE RS232", "HMS", "30 kg 250*300 mm Eco Metal Pole RS232", "Table-top / counter scale", "HMS 30 kg Eco Metal Pole RS232"),
  SCALE("HMS", "30 KG 250*300 MM 3 WINDOW PIECE COUNTING", "HMS", "30 kg 250*300 mm 3 Window Piece Counting", "Table-top / counter scale", "HMS 30 kg / 1 g 3 Window Piece Counting Metal Rear"),
  SCALE("HMS", "30 KG 250*300 MM 3 WINDOW PRICE COMPUTING", "HMS", "30 kg 250*300 mm 3 Window Price Computing", "Table-top / counter scale"),
  SCALE("HMS", "30 KG 250*300 MM TOP SS BOTTOM MS REAR", "HMS", "30 kg 250*300 mm Top SS Bottom MS Rear", "Table-top / counter scale"),
  SCALE("HMS", "30 KG 250*300 MM SS POLE", "HMS", "30 kg 250*300 mm SS Pole", "Table-top / counter scale", "HMS 30 kg SS Pole"),
  SCALE("HMS", "30 KG 210*210 SS CHI", "HMS", "30 kg 210*210 SS CHI", "Platform / floor scale", "HMS 30 kg 210*210 SS CHI"),
  SCALE("HMS", "50 KG PRICE COMPUTING SS", "HMS", "50 kg Price Computing SS", "Table-top / counter scale"),
  SCALE("HMS", "50 KG 250*250 SS CHI", "HMS", "50 kg 250*250 SS CHI", "Platform / floor scale", "HMS 50 kg 250*250 SS CHI"),
  SCALE("HMS", "50 KG 250*250 MS CHI", "HMS", "50 kg 250*250 MS CHI", "Platform / floor scale", "HMS 50 kg 250*250 MS CHI"),
  SCALE("HMS", "50 KG BENCH POLE 2 DISPLAY", "HMS", "50 kg Bench Pole 2 Display", "Platform / floor scale"),
  SCALE("HMS", "50 KG BENCH POLE 1 DISPLAY", "HMS", "50 kg Bench Pole 1 Display", "Platform / floor scale", "HMS 50 kg Bench Pole"),
  SCALE("HMS", "100 KG 300*300 MS CHI", "HMS", "100 kg 300*300 MS CHI", "Platform / floor scale", "HMS 100 kg 300*300 MS CHI"),
  SCALE("HMS", "100 KG 300*300 SS CHI", "HMS", "100 kg 300*300 SS CHI", "Platform / floor scale", "HMS 100 kg 300*300 SS CHI"),
  SCALE("HMS", "100 KG 400*400 SS PLTFRM", "HMS", "100 kg 400*400 SS Platform", "Platform / floor scale", "HMS 100 kg 400*400 SS Platform"),
  SCALE("HMS", "200 KG 500*500 SS PLTFRM", "HMS", "200 kg 500*500 SS Platform", "Platform / floor scale", "HMS 200 kg 500*500 SS Platform"),
  SCALE("HMS", "200 KG 450*350 ADULT SCALE", "HMS", "200 kg 450*350 Adult Scale", "Personal / health scale", "HMS 200 kg Adult Weighing"),
  SCALE("HMS", "300 KG 400*400 MS CHI", "HMS", "300 kg 400*400 MS CHI", "Platform / floor scale", "HMS 300 kg 400*400 MS CHI"),
  SCALE("HMS", "300 KG 400*400 SS CHI", "HMS", "300 kg 400*400 SS CHI", "Platform / floor scale", "HMS 300 kg 400*400 SS CHI"),
  SCALE("HMS", "300 KG 500*500 MS CHI", "HMS", "300 kg 500*500 MS CHI", "Platform / floor scale", "HMS 300 kg 500*500 MS CHI"),
  SCALE("HMS", "300 KG 500*500 SS CHI", "HMS", "300 kg 500*500 SS CHI", "Platform / floor scale", "HMS 300 kg 500*500 SS CHI"),
  SCALE("HMS", "300 KG 600*600 SS CHI", "HMS", "300 kg 600*600 SS CHI", "Platform / floor scale", "HMS 300 kg 600*600 SS CHI"),
  SCALE("HMS", "300 KG 600*600 MS CHI", "HMS", "300 kg 600*600 MS CHI", "Platform / floor scale", "HMS 300 kg 600*600 MS CHI"),
  SCALE("HMS", "300 KG 600*600 MS PLTFRM", "HMS", "300 kg 600*600 MS Platform", "Platform / floor scale", "HMS 300 kg 600*600 MS Platform"),
  SCALE("HMS", "300 KG 600*600 SS PLTFRM", "HMS", "300 kg 600*600 SS Platform", "Platform / floor scale", "HMS 300 kg 600*600 SS Platform"),
  SCALE("HMS", "500 KG 750*750 MM SINGLE LOADCELL PLTFRM", "HMS", "500 kg 750*750 mm Single Load Cell Platform", "Platform / floor scale", "HMS 500 kg 750*750 mm Single Load Cell"),
  SCALE("HMS", "500 KG 750*750 MM FOUR LOADCELL PLTFRM", "HMS", "500 kg 750*750 mm Four Load Cell Platform", "Platform / floor scale", "HMS 500 kg 750*750 mm 4 Load Cell"),
  SCALE("HMS", "1 TON 1000*1000 MM PLTFRM", "HMS", "1 ton 1000*1000 mm Platform", "Platform / floor scale", "HMS 1 ton 1000*1000 mm"),
  SCALE("HMS", "1 TON 1000*1000 MM WITH 3 MM SHEET PLTFRM", "HMS", "1 ton 1000*1000 mm 3 mm Sheet Platform", "Platform / floor scale"),
  SCALE("HMS", "2 TON 1200*1200 MM PLTFRM", "HMS", "2 ton 1200*1200 mm Platform", "Platform / floor scale", "HMS 2 ton 1200*1200 mm"),
  SCALE("HMS", "2 TON 1200*1200 MM WITH 3 MM SHEET PLTFRM", "HMS", "2 ton 1200*1200 mm 3 mm Sheet Platform", "Platform / floor scale"),
  SCALE("HMS", "5 TON 1500*1500 MM PLTFRM", "HMS", "5 ton 1500*1500 mm Platform", "Platform / floor scale", "HMS 5 ton 1500*1500 mm"),
  SCALE("HMS", "5 TON CRANE SCALE", "HMS", "5 ton Crane Scale", "Crane scale", "HMS 5 ton Crane Scale"),
  SCALE("HMS", "10 TON CRANE SCALE", "HMS", "10 ton Crane Scale", "Crane scale", "HMS 10 ton Crane Scale"),
  SCALE("HMS", "300 KG 500*600MM SS TROLLY", "HMS", "300 kg 500*600 mm SS Trolley", "Trolley scale"),
  SCALE("HMS", "300 KG 500*600MM MS TROLLY", "HMS", "300 kg 500*600 mm MS Trolley", "Trolley scale"),
];

const FAM_NAME: Record<Fam, string> = {
  WEIGHING_SCALES: "Weighing Scales",
  BILLING_MACHINE: "Billing Machine",
  TOUCH_POS: "Touch POS",
  OFFICE_AUTOMATION: "Office Automation",
  BILLING_SOFTWARE: "Billing Software",
};
const FAM_CODE: Record<Fam, string> = { WEIGHING_SCALES: "WS", BILLING_MACHINE: "BM", TOUCH_POS: "POS", OFFICE_AUTOMATION: "OA", BILLING_SOFTWARE: "SW" };
const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
const cf = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const nameOf = (i: Item) => (i.brand === "Generic" ? i.model : `${i.brand} ${i.model}`);

async function main() {
  const t = TENANT;
  const [products, brands, vendors, cats] = await Promise.all([
    prisma.product.findMany({ where: { tenantId: t, deletedAt: null } }),
    prisma.brand.findMany({ where: { tenantId: t, deletedAt: null } }),
    prisma.vendor.findMany({ where: { tenantId: t, deletedAt: null } }),
    prisma.productCategory.findMany({ where: { tenantId: t, deletedAt: null, parentId: null }, orderBy: { createdAt: "asc" } }),
  ]);
  // Only the products loaded from HMS's IT register — old sample products share some names
  const byName = new Map(
    products.filter((p) => cf(p.attributes).source === "hms-it-register-2026").map((p) => [p.name, p]),
  );
  const catOf = (f: Fam) => cats.find((c) => c.name.toLowerCase() === FAM_NAME[f].toLowerCase())?.id ?? null;

  // checks
  const missing = ITEMS.filter((i) => i.same && !byName.has(i.same)).map((i) => i.same);
  if (missing.length) throw new Error(`"same" products not found: ${missing.join(", ")}`);
  const sameTwice = ITEMS.map((i) => i.same).filter((x, k, a) => x && a.indexOf(x) !== k);
  if (sameTwice.length) throw new Error(`product used twice: ${sameTwice.join(", ")}`);

  const keep = ITEMS.filter((i) => i.same);
  const add = ITEMS.filter((i) => !i.same);
  const keptIds = new Set(keep.map((i) => byName.get(i.same!)!.id));
  const hide = products.filter((p) => p.isActive && !keptIds.has(p.id));

  const newBrands = [...new Set(ITEMS.map((i) => i.brand))].filter((b) => !brands.some((x) => x.name.toLowerCase() === b.toLowerCase()));
  const newVendors = [...new Set(ITEMS.flatMap((i) => i.suppliers ?? []))].filter((v) => !vendors.some((x) => x.name.toLowerCase() === v.toLowerCase()));

  console.log(`Stock list: ${ITEMS.length} models → ${keep.length} same as a loaded product (kept, renamed), ${add.length} new, ${hide.length} loaded products hidden`);
  console.log(`New brands: ${newBrands.join(", ") || "—"} · new suppliers: ${newVendors.join(", ") || "—"}`);
  console.log("\n== KEPT (same model, renamed to HMS's wording)");
  for (const i of keep) {
    const old = i.same!;
    const now = nameOf(i);
    console.log(`  ${old === now ? "  " : "↻ "}${old}${old === now ? "" : `  →  ${now}`}`);
  }
  console.log("\n== NEW");
  for (const i of add) console.log(`  + ${nameOf(i)}   [${i.type}]`);
  console.log("\n== HIDDEN (loaded from the IT register, not on the stock list)");
  const byBrand = new Map<string, string[]>();
  for (const p of hide) {
    const b = String(cf(p.attributes).brand ?? "—");
    byBrand.set(b, [...(byBrand.get(b) ?? []), p.name]);
  }
  for (const [b, l] of [...byBrand.entries()].sort()) console.log(`  ${b} (${l.length}): ${l.join(" | ")}`);

  // machine-readable report for the spreadsheet
  fs.writeFileSync(
    path.resolve("backups", "hms-stock-list-diff-2026-11-18.json"),
    JSON.stringify({
      keep: keep.map((i) => ({ heading: i.heading, text: i.text, old: i.same, now: nameOf(i), type: i.type })),
      add: add.map((i) => ({ heading: i.heading, text: i.text, now: nameOf(i), type: i.type })),
      hide: hide.map((p) => ({ brand: cf(p.attributes).brand ?? "", name: p.name, type: cf(p.attributes).machineType ?? "" })),
    }, null, 1),
  );

  if (!APPLY) {
    console.log("\nDry run — nothing written. Add --apply to load.");
    return;
  }

  const backup = path.resolve("backups", `products-before-stock-list-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(backup, JSON.stringify({ products, brands }, null, 1));
  console.log(`Backup: ${backup}`);

  const used = new Set(brands.map((b) => b.code));
  const code = (n: string) => {
    const base = n.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) || "BRAND";
    let c = base;
    for (let k = 2; used.has(c); k++) c = `${base.slice(0, 8)}${k}`;
    used.add(c);
    return c;
  };
  if (newBrands.length) await prisma.brand.createMany({ data: newBrands.map((n) => ({ id: newId(), tenantId: t, name: n, code: code(n), isActive: true })) });
  if (newVendors.length) await prisma.vendor.createMany({ data: newVendors.map((n) => ({ id: newId(), tenantId: t, name: n })) });
  const allBrands = await prisma.brand.findMany({ where: { tenantId: t, deletedAt: null } });
  const brandId = (n: string) => allBrands.find((b) => b.name.toLowerCase() === n.toLowerCase())?.id ?? null;
  // brands used by the list must be visible
  await prisma.brand.updateMany({ where: { tenantId: t, name: { in: [...new Set(ITEMS.map((i) => i.brand))] } }, data: { isActive: true } });

  const attrs = (i: Item, prev: Record<string, unknown> = {}) => {
    const prevSup = Array.isArray(prev.suppliers) ? (prev.suppliers as string[]) : [];
    return {
      ...prev,
      brand: i.brand,
      brandId: brandId(i.brand),
      model: i.model,
      machineType: i.type,
      suppliers: [...new Set([...(i.suppliers ?? []), ...prevSup])],
      catalogFamily: i.fam,
      catalogFamilyName: FAM_NAME[i.fam],
      catalogKind: i.kind,
      requiresStamping: i.fam === "WEIGHING_SCALES",
      gcApplicable: true,
      warrantyMonths: prev.warrantyMonths ?? 12,
      amcApplicable: i.fam === "WEIGHING_SCALES",
      stockListName: i.text,
      stockListHeading: i.heading,
      source: "hms-stock-list-2026-11-18",
    };
  };

  // kept: rename + refresh (same id → everything linked stays linked)
  const updates = keep.map((i) => {
    const p = byName.get(i.same!)!;
    return prisma.product.update({
      where: { id: p.id },
      data: { name: nameOf(i).slice(0, 191), isActive: true, categoryId: catOf(i.fam) ?? p.categoryId, attributes: attrs(i, cf(p.attributes)) as object },
    });
  });
  for (let k = 0; k < updates.length; k += 20) await Promise.all(updates.slice(k, k + 20));

  // new
  const skus = new Set(products.map((p) => p.sku));
  const data = add.map((i) => {
    let sku = `HMS-${FAM_CODE[i.fam]}-${slug(i.brand).slice(0, 10)}-${slug(i.model).slice(0, 34)}`;
    for (let k = 2; skus.has(sku); k++) sku = `${sku.slice(0, 60)}-${k}`;
    skus.add(sku);
    return {
      id: newId(),
      tenantId: t,
      sku,
      name: nameOf(i).slice(0, 191),
      categoryId: catOf(i.fam),
      productType: "GOODS" as const,
      unit: "NOS",
      trackInventory: true,
      isActive: true,
      taxPercent: 18,
      attributes: attrs(i) as object,
    };
  });
  if (data.length) await prisma.product.createMany({ data });

  // hide the rest
  if (hide.length) await prisma.product.updateMany({ where: { id: { in: hide.map((p) => p.id) } }, data: { isActive: false } });
  console.log(`Done: ${keep.length} kept, ${data.length} added, ${hide.length} hidden.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
