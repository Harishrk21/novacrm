# NovaCRM — Full System Roadmap (Client Requirements)

**Purpose:** After the service dashboard demo, the client wants a **complete business system** for a weighing / billing / CCTV / biometric equipment company — covering **field staff attendance**, **customer & product master data**, **sales (leads → demo → sale → invoice)**, **serial-level inventory**, and **service / stamping / AMC**.

This document explains **what each requirement means in plain language**, **what NovaCRM already has**, and **how we should implement the gaps** in clear phases.

---

## How to read this document

| Symbol | Meaning |
|--------|---------|
| ✅ | Already in NovaCRM (may need polish) |
| 🟡 | Partially there — extend existing screens/APIs |
| ⬜ | New module — not built yet |

**Suggested delivery order (priority):**  
1 → Customer + products (data foundation) → 2 → Inventory serial stock → 3 → Sales / lead / demo → 4 → Service depth → 5 → Stamping & AMC dashboards → 6 → Attendance + GPS mobile.

---

# Part A — Attendance & field discipline

## A1. Office hours & attendance status

**Business rule**

| Item | Rule |
|------|------|
| Office hours | **10:00 AM – 6:30 PM** |
| Present | Staff marked in (on time or within rules) |
| Absent | No valid check-in for the day |
| Late permissions | **4 permissions per calendar month** |
| Permission window | Arrive by **11:00 AM** *or* leave from **5:00 PM** (permission covers late in / early out in that window) |
| After 4 permissions used | Every **15 minutes late** is counted as **Late** (for payroll / HR reporting) |

**What the system should do**

1. Employee **checks in / checks out** each day.  
2. System compares time to **10:00 / 18:30** and permission rules.  
3. Auto-calculate: Present / Absent / Late / Permission used.  
4. Admin web screen: monthly table per employee (days present, permissions left, late minutes).

| Status | |
|--------|--|
| Today | ⬜ New module |

### How to implement

| Layer | Work |
|-------|------|
| Database | `AttendanceDay` (user, date, checkIn, checkOut, status, permissionUsed, lateMinutes), `AttendancePermission` (month quota = 4) |
| API | Check-in, check-out, admin list/export, monthly summary |
| Web (admin) | Attendance table + filters (employee, month) + export CSV |
| Config | Tenant settings: office start/end, permission count, late bucket = 15 min |
| Payroll link (later) | Export late minutes / absences for salary deduction |

---

## A2. GPS + photo attendance (mobile)

**Business rule**

- Field / office staff use a **mobile app** (or PWA) to mark attendance.  
- Each punch must capture:
  1. **Photo** (selfie / site photo)  
  2. **GPS** (lat/lng + accuracy)  
  3. **Timestamp** (server time + device time)  

**Web app**

- Admin sees a **table**: Employee | Date | In/Out | Time | Photo thumb | Map link | Status (Present/Late/…).

| Status | |
|--------|--|
| Today | ⬜ New (mobile + upload + map) |

### How to implement

| Layer | Work |
|-------|------|
| Mobile / PWA | Camera + Geolocation APIs; upload image to existing `/uploads` |
| Database | Store `photoUrl`, `lat`, `lng`, `accuracyM`, `capturedAt` on attendance punch |
| Fraud controls (v2) | Geo-fence office/customer sites; flag if GPS accuracy poor or photo missing |
| Web | Attendance grid with photo lightbox + “Open in Maps” |

**Note:** Full native Android/iOS can come later; start with **responsive PWA** so one codebase serves phone + web.

---

# Part B — Customer master (data entry)

## B1. Full customer / shop profile

Client wants **every shop captured completely** (not only name + one phone).

| Field | Notes |
|-------|--------|
| Company / shop / customer name | Primary display name |
| Door number | |
| Street | |
| Building name | |
| Area | |
| City | |
| State | |
| PIN code | |
| Landmark | |
| Landline | |
| Mobile 1 | Primary |
| Mobile 2 | Optional |
| Mobile 3 | Optional |
| WhatsApp number | May differ from mobile |
| Email | |
| GPS location | Lat/lng of shop (for service routing later) |
| Lead / executive | Name of executive or “Office” who owns the account |

| Status | |
|--------|--|
| Today | 🟡 Customers exist (name, phone, address fields, area, etc.) — **extend** for multi-mobile, building, GPS, landline, WhatsApp dedicated field |

### How to implement

1. Extend `Contact` (and form on Add customer) with missing columns / `customFields` where rare.  
2. GPS: “Capture location” button on web (browser geolocation) + optional map pin.  
3. “Owner executive” = existing `ownerUserId` (label as Lead / Executive).  
4. Validation: at least Mobile 1 required; PIN format; phone normalize (already partially done).

---

# Part C — Products on the customer (installed machines)

Each **customer machine** is tracked like a vehicle — with type-specific specs.

## C1. Machine types & fields

| Product type | Fields client wants |
|--------------|---------------------|
| **Weighing M/C** | Model, Serial, Capacity, Accuracy, Platform size, **Stamping number**, **Stamping date** |
| **Billing machine** | Model, Serial |
| **Currency counting (CCM)** | Model, Serial |
| **Biometric** | Model, Serial |
| **Paper shredder** | Model, Serial |
| **Paper roll (billing printer)** | Model |
| **CCTV** | Optional; **multiple components** (DVR/NVR, cameras, HDD, cables…) |

**Stamping (explained for non-technical):**  
Government validates the weighing machine and stamps it as accurate — similar to **FC (fitness certificate) for a car**. Expiry / next due must be tracked.

| Status | |
|--------|--|
| Today | 🟡 `CustomerAsset` already has machine types, model, serial, capacity, accuracy, platform, stamping date, next due, AMC — **add stamping number**; **CCTV multi-component** as child rows |

### How to implement

1. Add `stampingNumber` on asset.  
2. CCTV: `CustomerAssetComponent` (parent asset = CCTV site kit; lines = camera 1, DVR, etc. with serials).  
3. Customer → Products tab: type-specific form (show weighing fields only for weighing, etc.).  
4. Keep origin: Sold by us vs Outside (already present).

---

# Part D — Inventory (stock with serial numbers)

## D1. Stock in one-by-one with serial + upload

**Business rule**

- When stock arrives, enter **each unit** with its **serial number** (not only quantity).  
- Allow **upload** (CSV / Excel / photo of invoice) to speed entry.  
- Later: sale / demo / return / service spare must move that **exact serial**.

| Status | |
|--------|--|
| Today | 🟡 ERP Products + Inventory quantity exist — **serial-level stock units** are the gap |

### How to implement

| Concept | Meaning |
|---------|---------|
| Product (SKU) | Catalogue: “Weighing 30kg Platform X” |
| StockUnit | One physical piece: `serialNo`, status = InStock / Demo / Sold / Returned / Scrap |
| GRN / Stock In | Form: pick product → add rows of serials → optional file upload |

**Screens**

1. **Stock In** — add serials (manual + CSV upload).  
2. **Stock list** — filter by product, status, serial search.  
3. **Returns** — mark unit Returned → back to InStock (or Quarantine).

---

# Part E — Sales tracking

## E1. Lead (enquiry)

| Field | Purpose |
|-------|---------|
| Customer details | New or link existing customer |
| Interested product | Product / model interest |
| Price | Quoted price |
| Executive details | Who is handling |
| Date | Enquiry date |
| Status | **Pending** / **Converted** / **Not interested** |
| Customer type | **Existing** / **New** |

| Status | |
|--------|--|
| Today | 🟡 Leads module exists — **align statuses & fields** to this simpler sales language; link interested product + price |

### How to implement

- Map statuses: Pending ≈ NEW/CONTACTED/QUALIFIED; Converted; Not interested ≈ LOST/UNQUALIFIED.  
- Add: `interestedProductId`, `quotedPrice`, `isExistingCustomer`.  
- Keep assign-to-executive (already there).

---

## E2. Demo phase (inventory impact)

**Business rule (critical)**

1. Executive takes a **physical product** to customer site for demo.  
2. That serial leaves warehouse → status **Demo** (inventory reduces for “available to sell”).  
3. If customer buys → mark **Sold** (demo converts to sale).  
4. If customer rejects → **Return to stock** (Demo → InStock).

| Status | |
|--------|--|
| Today | ⬜ Demo stock flow not built |

### How to implement

| Action | StockUnit status | Lead status |
|--------|------------------|-------------|
| Issue for demo | InStock → **Demo** | Pending + flag `demoActive` |
| Confirm sale | Demo → **Sold** | Converted + create sale/invoice |
| Return from demo | Demo → **InStock** | Still Pending / Not interested |

UI: Lead detail → “Issue demo unit” (pick serial) → “Convert demo to sale” / “Return demo”.

---

## E3. Add sale details (convert lead → sale)

- One click/flow: Lead **Converted** → create **Sale** record (customer + serials + price + executive + date).  
- Optionally create **Invoice / Proforma** in same flow.

| Status | |
|--------|--|
| Today | 🟡 Lead convert exists (→ contact/account/deal) — **retarget to Sale + serial + invoice** instead of generic “deal” |

---

## E4. Invoice — Order / Proforma

| Document | Use |
|----------|-----|
| Proforma | Quote / advance before delivery |
| Tax invoice / Order invoice | After confirmation |

| Status | |
|--------|--|
| Today | 🟡 Invoices ERP exists — add **Proforma** type + link to Sale / Lead |

---

## E5. Inventory — returns + demo tracking

- Menu: **Returns** (customer return / demo return).  
- Dashboard widget: **Demo inventory** (all units currently at customer sites).

| Status | |
|--------|--|
| Today | ⬜ |

---

# Part F — Service (after-sales)

Client wants a full **service job lifecycle** (much of this is already the ticket system).

| # | Requirement | NovaCRM today | Gap |
|---|-------------|----------------|-----|
| 1 | Customer details | ✅ Linked contact | — |
| 2 | Product details | ✅ Linked machine asset | — |
| 3 | Issue log | ✅ Subject / notes / messages | Structured issue codes (optional) |
| 4 | Assigned engineer | ✅ Assign to | — |
| 5 | Date & time | ✅ Created / SLA | Visit schedule slots |
| 6 | GC / NGC (warranty) | 🟡 Origin Sold vs Outside | Explicit **GC / NGC** + warranty expiry fields |
| 7 | AMC / Non-AMC | ✅ On machine + AMC page | Stronger dashboards |
| 8 | Attending dates as it progresses | 🟡 Status changes | **Visit log** timeline (arrived / parts / left) |
| 9 | Payment: advance, due | ✅ OD / total / advance / balance | — |
| 9b | Spares changed | ⬜ | Spare lines → deduct stock + show on **customer page** like a mini sale |
| 10 | Status | ✅ Open → … → Closed | — |

### How to implement (service gaps)

1. **GC / NGC** on asset or ticket (`warrantyType`, `warrantyUntil`).  
2. **ServiceVisit** log: timestamp + note + engineer.  
3. **SpareIssue**: pick stock serial or SKU qty → attach to ticket → appear under customer Products / Spares history.  
4. Keep WhatsApp / receipt / invoice flows already built.

---

# Part G — Stamping tracking & AMC tracking

## G1. Stamping tracking

- List all weighing machines with: stamping number, last stamp date, **next due**, days left, customer, executive.  
- Alerts: due in 30/15/7 days; overdue.  
- Reminder WhatsApp (partially exists for maintenance/AMC).

| Status | |
|--------|--|
| Today | 🟡 Dates on asset + reminders — need **dedicated Stamping register** UI + stamping number |

## G2. AMC tracking

- Contracts: start/end, amount (optional), machines covered, renewals.  
- Dashboard: Active / Expiring / Expired.  
- Link to service tickets (AMC jobs free or discounted — business rule configurable).

| Status | |
|--------|--|
| Today | 🟡 AMC / Non-AMC page + dates — deepen into **contract register + renewals** |

---

# Part H — Target system map (one picture)

```text
                    ┌─────────────────────┐
                    │   Attendance + GPS  │  (HR / field)
                    └──────────┬──────────┘
                               │
┌──────────────┐    ┌──────────▼──────────┐    ┌─────────────────┐
│ Lead → Demo  │───▶│  Serial Inventory   │───▶│ Sale → Invoice  │
│ → Convert    │    │  InStock/Demo/Sold  │    │ Proforma/Tax    │
└──────┬───────┘    └──────────┬──────────┘    └────────┬────────┘
       │                       │                        │
       ▼                       ▼                        ▼
┌──────────────┐    ┌──────────────────────┐   ┌────────────────┐
│  Customer    │◀───│ Installed machines   │──▶│ Service ticket │
│  master+GPS  │    │ Stamping + AMC       │   │ Spares + pay   │
└──────────────┘    └──────────────────────┘   └────────────────┘
```

---

# Part I — Implementation phases (recommended)

## Phase 0 — Align & polish (1–2 weeks)

- Expand **customer form** to client field list.  
- Add **stamping number**; clarify GC/NGC on machine.  
- Lead statuses/labels match Pending / Converted / Not interested.  
- Service: visit notes + spare tracking light version.

**Outcome:** Demo feels “their language”; less re-training.

## Phase 1 — Serial inventory + demo (3–4 weeks)

- `StockUnit` + Stock In (serial + CSV upload).  
- Demo issue / return / convert-to-sale.  
- Demo inventory report + Returns menu.  
- Sale record linked to invoice.

**Outcome:** Warehouse and sales executives trust stock numbers.

## Phase 2 — Stamping & AMC command centre (2 weeks)

- Stamping register + filters + CSV.  
- AMC contract register + expiry dashboard.  
- Tighten WhatsApp reminders.

**Outcome:** Compliance (stamping) and recurring revenue (AMC) visible to management.

## Phase 3 — Attendance + GPS PWA (3–4 weeks)

- Check-in/out rules (10–6:30, 4 permissions, 15‑min late).  
- Photo + GPS punches.  
- Admin attendance table.

**Outcome:** HR + field accountability.

## Phase 4 — Hardening (ongoing)

- Roles (office vs engineer vs sales).  
- Offline-tolerant mobile.  
- Geo-fence.  
- Accounting export.  
- CCTV multi-component kits fully modelled.

---

# Part J — Module checklist (for client sign-off)

| Module | Must-have for “full system” | Priority |
|--------|----------------------------|----------|
| Customer master (full address + 3 mobiles + WhatsApp + GPS) | Yes | P0 |
| Machine types + weighing stamping fields | Yes | P0 |
| Serial stock in / out / demo / sold | Yes | P0 |
| Lead → Demo → Sale → Invoice | Yes | P0 |
| Service ticket + payment + engineer | Yes (mostly done) | P0 |
| Spares on service → customer history | Yes | P1 |
| Stamping tracking dashboard | Yes | P1 |
| AMC tracking dashboard | Yes | P1 |
| Proforma invoice | Yes | P1 |
| Attendance Present/Absent/Permission/Late | Yes | P2 |
| GPS + photo attendance app | Yes | P2 |
| CCTV multi-component | Nice | P2 |
| Native mobile apps | Nice | P3 |

---

# Part K — What we need from the client (to build without rework)

1. **Confirm office GPS** (or radius in metres) if geo-fence is required.  
2. **Sample Excel** of current stock / customer / stamping register (column names).  
3. **Permission policy**: is “leave at 5 PM” a permission, or only late arrival till 11 AM? (Document assumes both use the monthly quota of 4.)  
4. **GC vs NGC definition** in their words (warranty months per product type).  
5. **Who uses mobile attendance** — all staff or only field executives?  
6. **Invoice series** — separate numbers for Proforma vs Tax invoice?

---

# Part L — One-line summary for the client

> NovaCRM today is strong on **service tickets, customers, machines, AMC flags, and invoices**.  
> To become their **full business OS**, we add **serial-level inventory + demo sales**, **richer customer/product masters**, **stamping & AMC control panels**, then **GPS photo attendance** — in that order so sales and stock stay correct before HR mobile work.

---

*Document version: 1.0 — for internal planning & client workshop. Update after Phase 0 field mapping.*
