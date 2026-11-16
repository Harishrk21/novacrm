# Service ticket lifecycle (enforced)

_Updated 2026-11-11 — matches the app (boss entries 35–38 + service cleanup). Source of truth for the
step bar / "Next" line: `src/lib/serviceFlow.ts`; server rules: `backend/src/modules/tickets/ticketLifecycle.ts`._

## The 6 steps (shown on every ticket as a step bar + "Next · step · who — what")

| # | Step | Who (login) | Done when |
|---|------|-------------|-----------|
| 1 | **Logged** | Service desk | Ticket created — always `OPEN`, unassigned. Customer WhatsApp "ticket created". All engineers get a "job available" bell. |
| 2 | **Accepted** | First engineer to click **Accept** (admin may assign instead) | An engineer owns the job. |
| 3 | **Work logged** | Engineer — **Start work** (`IN_PROGRESS`), then a day note in Daily tracking (stamping: **Save stamp result**) | There is a record of the work. |
| 4 | **Paid** — any time | Engineer on the job, desk or admin — **Mark paid** (UPI/NEFT/RTGS/CARD need UTR + proof; cheque needs number) | Paid in full, **or** ticked **Free job (GC / AMC / warranty)** with no charge. |
| 5 | **Complete** | Engineer or desk — **Mark complete** (`RESOLVED`) | Only after steps 3 + 4. Approvers (admin / manager / desk) get a bell; customer WhatsApp "completed". |
| 6 | **Closed** | Desk / admin — **Approve & close** (`CLOSED`) | Opens the service report. Admin raises the service proforma from **Documents** (final GST bill stays in Tally). |

Skipped steps show as **Missed** (amber) on the ticket, e.g. a job completed without payment.

## Rules the server enforces

| Attempt | Result |
|---------|--------|
| `OPEN` → `RESOLVED` / `CLOSED` | Blocked — accept / start first |
| `RESOLVED` without an engineer | Blocked |
| `RESOLVED` / `CLOSED` without payment | Blocked unless **Paid** or explicitly **Free job** |
| ₹0 charge but not marked Free job | **Not free** — enter the charge or tick Free job |
| Mark paid without method / online proof | Blocked |
| `CLOSED` without `RESOLVED` first | Blocked |
| Close / reopen a closed job | Desk / admin only |
| Service invoice before `RESOLVED` | Blocked |

**Job state (hold / resume):** `On hold (PENDING)` while waiting for parts or the customer, resume to `IN_PROGRESS`, or reopen. Complete and close only go through their buttons (with the checks above).

**One engineer field:** pick the engineer once. "Received by" and "Delivered by" on the job sheet / service report are filled from the engineer automatically at Mark complete.

**Pool reminder (hourly, live server only):** a job still unaccepted after `POOL_REMIND_HOURS` (default 2 h) → bell to admin / manager / desk ("assign an engineer") and to engineers ("still available"); repeated at most every 4 h per job.

## Categories (one list)

Breakdown / repair · Installation · AMC visit · Other — and **Stamping** as its own job kind. Old "Service" / blank tickets were moved to Breakdown (2026-11-11).

## Stamping visits (same 6 steps)

1. **Stamping page → New stamping job**, or open a customer machine → **Open stamping job** (category = Stamping, customer + machine prefilled).
2. Same path: Logged → Accepted → Work logged (**Save stamp result**: stamp date, next due, quarter) → Paid / Free job → Mark complete → Approve & close.
3. The machine register's stamping dates update from the ticket; the Stamping page stays the compliance / due list.

Do **not** invent a parallel workflow — stamping is a ticket **category**, not a separate board.

**Activities** (`/activities`) are CRM follow-ups (calls / tasks), not this pipeline.
