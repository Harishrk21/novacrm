# Service ticket lifecycle (enforced)

Crystal-clear **6-step** path (UI progress bar on ticket detail):

| Step | Who | What happens |
|------|-----|----------------|
| **1 Created** | Service desk | Opens ticket as `OPEN`, unassigned. No engineer picker. |
| **2 Assigned** | Admin | Assigns engineer → `IN_PROGRESS`. WhatsApp to customer + engineer. |
| **3 On site** | Engineer | Starts work; reviews customer history (AI summary optional). |
| **4 Daily tracking** | Engineer | Day 1…N notes (`customFields.dayNotes`) — visible to admin on timeline. |
| **5 Admin close** | Engineer → Admin | Engineer **Mark complete** → `RESOLVED`. Admin verifies, **Mark paid** if charged, **Approve & close** → `CLOSED`. |
| **6 Invoice** | Admin | Auto-opens service proforma prefilled from ticket; create stores under Invoices (HMS logo on form/print). Final GST stays in Tally. |

Canonical status machine:

1. **Desk / Admin create** → `OPEN` (desk always unassigned)
2. **Admin assigns** → `IN_PROGRESS` (auto on assign)
3. **Engineer works** → day notes, visits, spares (`workType` e.g. Spare replacement), photos, signature, amounts
4. **Engineer Mark complete** → `RESOLVED` (requires assignee; **cannot** jump from `OPEN`)
5. **Admin Mark paid** → method required; UPI/NEFT/RTGS/CARD need UTR + proof; writes ERP `Payment` row  
    - Typing Total/Advance alone never sets `PAID` (stays `PARTIAL` until Mark paid)
6. **Admin Approve & close** → `CLOSED` only from `RESOLVED` and only if **PAID** (or ₹0 free job); customer WhatsApp “completed” fires here; **redirects to ERP Invoices** with `type=service&ticketId=…`
7. **Create service invoice** on Invoices page:
   - Invoice type = **Service**
   - Customer pre-filled
   - Ticket must be `RESOLVED` or `CLOSED` with payment amounts set
   - Lines autofill from ticket; create links via `serviceTicketId` / `tickets.service_invoice_id`

## What cannot be skipped (API)

| Attempt | Result |
|--------|--------|
| `OPEN` → `RESOLVED` / `CLOSED` | Blocked |
| `CLOSED` without `RESOLVED` | Blocked |
| Close without PAID (non-zero job) | Blocked |
| Mark PAID without method / online proof | Blocked |
| Engineer assign / mark PAID / close | Blocked (role) |
| Desk complete / close | Blocked |
| Service invoice before RESOLVED | Blocked |

Sales machine bills use Invoice type = **Sales** (product + serial proforma) on the same page.

**Activities** (`/activities`) are CRM follow-ups (calls/tasks), not this pipeline — use **Service tickets** for Steps 1–6.

## Stamping visits (same 6 steps)

When a customer comes **for government stamping / verification**, treat it as a service ticket:

1. **Stamping page** → **New stamping job**, or open a customer machine → **Open stamping job**
2. Ticket create opens with **category = Stamping**, customer + machine prefilled
3. Desk enters stamp date / VC / plate / next due (+1 year) → subject `Stamping — {machine}`
4. Follow the **same** Created → Assigned → On site → Daily tracking → Admin close → Invoice path
5. Machine register dates update from the ticket; Stamping page stays the compliance / due list

Do **not** invent a parallel workflow — stamping is a ticket **category**, not a separate board.
