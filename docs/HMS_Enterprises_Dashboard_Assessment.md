---
title: HMS Enterprises — Dashboard Fit Assessment
author: NovaCRM Implementation Team
date: September 2, 2026
---

# HMS Enterprises — Dashboard Fit Assessment

**Prepared for:** HMS Enterprises (Chennai & Trichy)  
**System:** HMS Enterprises internal CRM (NovaCRM)  
**Sources:** Client paper forms (Service Report, Govt Stamping chit, Quotation/Proforma) + [hmsenterprises.in](https://www.hmsenterprises.in/index.html)

---

## 1. Executive summary

HMS Enterprises runs on **three paper workflows** plus a broad product range (weighing scales, billing machines, Touch POS, office automation, govt stamping, AMC, rental, buy-back).

The current CRM is **strong as an internal operations hub** (customers, machines, service jobs, stamping reminders, sales pipeline, inventory serials). It is **not yet a full paper replacement** for HMS’s pink forms or govt compliance documents.

| Overall fit for HMS paper workflows | **~6 / 10** |
|-------------------------------------|-------------|
| Customer & machine hub              | **8 / 10**  |
| Field service workflow              | **7 / 10**  |
| Stamping operations                 | **6 / 10**  |
| Sales / quotation                   | **5 / 10**  |
| Govt compliance / PDFs              | **3 / 10**  |

**Recommendation:** Position the system as *one place for customer + machine + service + stamping reminders + sales* — then add **Phase 1 printouts and compliance fields** to eliminate pink pads.

---

## 2. What HMS actually does

From the client forms and [HMS Enterprises website](https://www.hmsenterprises.in/index.html):

| Line of business | Real-world work |
|------------------|-----------------|
| **Sales** | Weighing scales, billing machines, Touch POS, office automation (Chennai Saidapet + Trichy) |
| **Service** | Breakdown repair, OEM spares, AMC |
| **Compliance** | Govt stamping / calibration (Dealer Licence 3161, Repairer Licence 2152 on forms) |
| **Other** | Rental, buy-back, installation (on website — not yet in CRM) |

### Paper workflow chain

```
Quotation/Proforma  →  Sale/Delivery  →  Installed machine
                              ↓
                    Govt stamping chit
                              ↓
                    Service report (job card)
```

---

## 3. Form 1 — Quotation / Proforma Invoice

**Example from client:** Order No. 4977 · Mr. Ramesh · Table top 50 kg · ₹5,500 − ₹200 discount = ₹5,300 · Cash · Delivery 14/8/24

| Paper field | CRM module | Status |
|-------------|------------|--------|
| Quote no. & date | Sale tracking + Invoices | Partial — no dedicated proforma |
| Customer name, phone, area | Customers | ✅ Good |
| Product (Table top 50 kg) | Products catalog | ✅ Good |
| Rate, qty, special discount | Invoices / sale price | ✅ On invoice; weak on quote PDF |
| Payment terms (100% cash) | — | ❌ Missing |
| Delivery date | — | ❌ Missing |
| Battery warranty note | Notes only | ❌ Missing structured field |
| Rupees in words | — | ❌ Missing |
| Customer / company signatures | — | ❌ Missing |

**Today:** Log enquiry → pick product → convert → invoice.  
**Gap:** Does not replace the **quotation pad** HMS gives customers before sale.

---

## 4. Form 2 — Govt stamping application

**Example from client:** S.No. 4153 · Kondattam Biriyani · Serial 2025641 · 100 kg / 200 g · Class III · SF ₹400 · Previous VC 1576325/22/04/25/...

| Paper field | CRM module | Status |
|-------------|------------|--------|
| Serial job number | Stamping / tickets | Partial |
| Customer + full address | Customers | ✅ Good |
| Model, make, serial | Customer machine + Inventory | ✅ Good (if entered once) |
| Capacity max/min, e=10g, Class III | Machine capacity, accuracy | Partial — no Class, no min capacity |
| Previous VC no./date | — | ❌ **Critical — missing** |
| SF / OD / CONV fees | Ticket amounts | Partial |
| Payment notes (Paid / NIL / collector) | Paid/unpaid | Partial — no mode or collector |
| Dealer / repairer licence on print | — | ❌ Missing |
| Tamil legal layout for govt | — | ❌ Missing PDF |

**Today:** Stamping page → record date + next due; **Due / In progress** tabs.  
**Gap:** Tracks **when** to stamp; does not produce **govt submission chit** or **VC history chain**.

---

## 5. Form 3 — Service report (pink job card)

**Example from client:** S.No. 46102 · Classic Enterprises · Engineer Ali · NGC · Battery ₹650 + Service ₹200 + Stamping ₹1,500 = ₹2,350 · GPay · Quarter D

| Paper field | CRM module | Status |
|-------------|------------|--------|
| Job S.No. | Ticket `ticketNo` | ✅ Good |
| Customer, phone, address | Customers + ticket | ✅ Good |
| Service engineer | Assign engineer | ✅ Good |
| Visit: Service / Stamping / Installation / Sales | Ticket category | Partial |
| GC / NGC / AMC | Warranty + machine plan | ✅ Good |
| Completed / Paid / GPay | Status + payment | Partial — no payment mode |
| Complaint + action taken | Description + visit log | ✅ Good |
| Machine capacity, brand, serial | Customer machine | ✅ Good |
| Stamping quarter A–D, VC date, plate no. | — | ❌ Missing |
| Spares line items + total | Spare parts + payment sync | ✅ Good (recent fix) |
| Spare warranty (e.g. battery 6 mo) | `underWarranty` on spare | ✅ Good |
| CGST / SGST on job | Invoices only | Partial |
| Printable pink chit + signatures | Basic job print | Partial — not HMS layout |

**Today:** Create job → engineer → spares → mark paid → complete.  
**Gap:** Field staff still need **HMS-style service report** for customer sign-off.

---

## 6. Scenarios — coverage matrix

| # | HMS scenario | Covered? | Where in CRM |
|---|--------------|----------|--------------|
| 1 | Walk-in sales enquiry | ✅ Yes | Sale tracking |
| 2 | Demo scale before sale | ✅ Yes | Sale tracking → Inventory demo |
| 3 | Convert sale → customer + serial | ✅ Mostly | Convert + customer machine |
| 4 | Proforma / quotation to customer | ❌ No | Needs quote PDF |
| 5 | Delivery + warranty on sale | ⚠️ Partial | Invoice only |
| 6 | New installation job | ⚠️ Partial | Tickets (no Installation type) |
| 7 | Breakdown service | ✅ Yes | Service tickets |
| 8 | AMC contract service | ✅ Yes | AMC + tickets |
| 9 | Govt stamping visit | ⚠️ Partial | Stamping register |
| 10 | Stamping renewal reminder | ✅ Yes | Stamping due + AMC |
| 11 | Spares + labour billing | ✅ Yes | Spare parts + ticket total |
| 12 | GPay / cash payment tracking | ❌ No | Needs payment mode |
| 13 | VC number / quarter A–D | ❌ No | New fields |
| 14 | Chennai vs Trichy branch | ❌ No | Single tenant |
| 15 | Rental / buy-back | ❌ No | Not in scope |
| 16 | Daily job register (46101, 46102…) | ⚠️ Partial | Ticket list |

**Estimated daily workflow coverage: ~55–60%**

---

## 7. Current strengths

| Strength | Benefit for HMS |
|----------|---------------|
| One customer record | No re-typing name/phone/address on every form |
| Machine linked to jobs | Capacity, serial, AMC/GC/NGC in one place |
| Stamping due / in progress | Replaces manual “who is due” tracking |
| Demo → sold serial flow | Matches warehouse + sales reality |
| Spares on ticket + total sync | Matches service report line items |
| Admin ERP + employee tickets | Office vs field roles |

---

## 8. Current gaps

| Gap | Business impact |
|-----|-----------------|
| No HMS-branded PDFs | Staff still use pink pads for customer/govt |
| No VC / stamping quarter | Renewal is date-only, not legal reference |
| No quotation mode | Sales desk still uses order pad |
| No payment mode | GPay/Cash/NIL Paid stays handwritten |
| No Chennai / Trichy branch | Hard to route jobs and reports |
| Website scope (POS, rental, buy-back) | CRM is weighing/service-centric |

---

## 9. Recommended build phases

### Phase 1 — Paper-light operations (highest priority)

1. **Service Report PDF** — match pink chit layout  
2. **Machine compliance fields** — VC no., previous VC, quarter A–D, plate no., Class, capacity min, e=dd  
3. **Payment on job** — mode (Cash/GPay/UPI), collected by, partial paid  
4. **Visit purpose** — Service | Stamping | Installation | Sales  
5. **Proforma / Quotation** — quote PDF with discount, delivery date, amount in words  

### Phase 2 — Stamping desk complete

6. Govt stamping application PDF (licence nos., fee table, Tamil header)  
7. VC renewal chain — auto-fill previous VC; next due from VC date  
8. Fee templates — SF by capacity/class  

### Phase 3 — Full HMS alignment

9. Branch — Chennai / Trichy  
10. Extended product catalog (billing machines, POS, CCTV)  
11. Installation workflow  
12. Daily job register view (serial list like 46101, 46102…)  
13. Rental / buy-back (optional)  

### Phase 4 — Polish

14. WhatsApp reminders — payment due + stamping due  
15. CGST/SGST on service job  
16. HMS branding on all prints (Saidapet address, 99529 59595)  

---

## 10. Requirement checklist

| Requirement | Fulfilled? |
|-------------|------------|
| Customer database | ✅ Yes |
| Machine register with serial | ✅ Yes |
| Service jobs with engineer | ✅ Yes |
| AMC / Non-AMC | ✅ Yes |
| GC / NGC warranty | ✅ Yes |
| Spares + charges on job | ✅ Yes |
| Stamping due reminders | ✅ Yes |
| Sale enquiry → demo → convert | ✅ Yes |
| Invoicing | ✅ Yes |
| Quotation pad replacement | ❌ No |
| Service report PDF (pink form) | ❌ No |
| Govt stamping PDF + VC tracking | ❌ No |
| Stamping quarter A–D | ❌ No |
| Payment mode (GPay/Cash) | ❌ No |
| Installation visit type | ⚠️ Partial |
| Chennai / Trichy branches | ❌ No |
| Rental / buy-back | ❌ No |
| Full website product catalog | ⚠️ Partial |

---

## 11. How to pitch to the client

> **Phase 1 (now):** One system for customer, machine, service, stamping reminders, and sales — staff stop re-typing; office sees who is due; engineers log spares and payment.  
>  
> **Phase 2 (next):** The three HMS printouts (quotation, stamping chit, service report) so pink pads go away.

**Demo suggestion:** Enter **Kondattam Biriyani / serial 2025641** once → show stamping due → create service job → add Battery + Service + Stamping lines → show total.

---

## 12. Contact references (HMS website)

- **Head office:** 93/4, Jeenis Road, Saidapet, Chennai - 600 015  
- **Phone:** 99529 59595 / 99529 49494  
- **Email:** sales@hmsenterprises.in  
- **Website:** https://www.hmsenterprises.in  

---

*Document generated for HMS Enterprises CRM implementation planning.*
