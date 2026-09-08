# Service ticket lifecycle (enforced)

Canonical path:

1. **Desk / Admin create** → `OPEN` (desk always unassigned)
2. **Admin assigns** → `IN_PROGRESS` (auto on assign)
3. **Engineer works** → day notes, visits, spares, photos, signature, amounts
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
