# WhatsApp Cloud API — Utility templates & setup checklist

## Meta webhook (local vs live)

Meta only accepts a **public HTTPS** callback. Localhost alone will not verify.

### Local development

Use a tunnel (ngrok) or reverse proxy (nginx → your API). Example:

| Field | Value |
|-------|--------|
| **Callback URL** | `https://YOUR-TUNNEL-HOST/api/integrations/whatsapp/cloud/webhook` |
| **Verify token** | Same as `WHATSAPP_VERIFY_TOKEN` in `backend/.env` (e.g. `verify_token`) |
| **Webhook fields** | Subscribe to `messages` |

- If the tunnel host changes, update Meta again.
- Optional: set `PUBLIC_API_URL=https://YOUR-TUNNEL-HOST` so Settings → WhatsApp shows the correct Copy URL.

### Production (live)

Point Meta at your **Render API** host (not the Vercel frontend):

| Field | Value |
|-------|--------|
| **Callback URL** | `https://YOUR-API.onrender.com/api/integrations/whatsapp/cloud/webhook` |
| **Verify token** | Exact match of Render env `WHATSAPP_VERIFY_TOKEN` |
| **Webhook fields** | `messages` |

On **Render → Environment**, set at least:

```env
PUBLIC_API_URL=https://YOUR-API.onrender.com
WHATSAPP_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_VERIFY_TOKEN=verify_token
WHATSAPP_BUSINESS_ACCOUNT_ID=...
WHATSAPP_APP_ID=...
WHATSAPP_APP_SECRET=...
WHATSAPP_API_VERSION=v21.0
```

Then in Meta Developer → WhatsApp → Configuration → Webhook → **Edit** → paste callback + verify token → **Verify and save** → subscribe to `messages`.

Also visible under CRM **Settings → WhatsApp** / Integrations (Copy buttons use `PUBLIC_API_URL` when set).

**Do not** use the old ngrok URL in production — replace it with the Render URL above.

---

Use this file when creating **Message templates** in Meta WhatsApp Manager.

- **Category for all templates below:** `UTILITY`
- **Language:** start with `English (en)` — add Tamil (`ta`) later if needed (same body, translated)
- **Type:** Text body + optional footer (no marketing offers / promotions)
- **Buttons:** optional; keep simple (none, or one “Call us” / URL if approved)

After Meta approves each template, note the **exact template name** and **language code** — the CRM must match them when sending.

---

## How to submit in Meta

1. Meta Business Suite → **WhatsApp Manager** → **Message templates** → **Create template**
2. Category → **Utility**
3. Paste **Template name** (lowercase, underscores only)
4. Paste **Body** exactly (keep `{{1}}`, `{{2}}`, … order)
5. Add sample values for each variable (required for review)
6. Submit → wait for **Approved**

---

## Template 1 — Ticket created (customer)

**Template name**

```
ticket_created_customer
```

**Category:** Utility  
**Language:** English

**Body (copy-paste)**

```
Hello {{1}}, your service request {{2}} has been registered with {{3}}. Machine / issue: {{4}}. Our team will contact you shortly. Thank you.
```

| Variable | Meaning | Sample for Meta review |
|----------|---------|------------------------|
| `{{1}}` | Customer name | Ramesh Kumar |
| `{{2}}` | Ticket number | ST-1042 |
| `{{3}}` | Company name | HMS Enterprises |
| `{{4}}` | Machine / subject | Platform scale 1T – not weighing |

**Footer (optional)**

```
HMS Enterprises — Service desk
```

---

## Template 2 — Ticket created / assigned (engineer)

**Template name**

```
ticket_assigned_engineer
```

**Category:** Utility  
**Language:** English

**Body (copy-paste)**

```
Hi {{1}}, new service job {{2}} assigned. Customer: {{3}}. Phone: {{4}}. Location: {{5}}. Issue: {{6}}. Please update status in CRM after visit.
```

| Variable | Meaning | Sample for Meta review |
|----------|---------|------------------------|
| `{{1}}` | Engineer name | Karthik |
| `{{2}}` | Ticket number | ST-1042 |
| `{{3}}` | Customer name | Ramesh Kumar |
| `{{4}}` | Customer phone | 9876543210 |
| `{{5}}` | Address / city | Guindy, Chennai |
| `{{6}}` | Issue / subject | Display blank |

**Footer (optional)**

```
HMS CRM — Field service
```

---

## Template 3 — Ticket status update (customer)

**Template name**

```
ticket_status_update
```

**Category:** Utility  
**Language:** English

**Body (copy-paste)**

```
Hello {{1}}, update on service request {{2}}: status is now {{3}}. Note: {{4}}. For help, reply to this chat or call us.
```

| Variable | Meaning | Sample for Meta review |
|----------|---------|------------------------|
| `{{1}}` | Customer name | Ramesh Kumar |
| `{{2}}` | Ticket number | ST-1042 |
| `{{3}}` | New status | In progress |
| `{{4}}` | Short note | Engineer visiting today 3–5 PM |

---

## Template 4 — Service completed (customer)

**Template name**

```
ticket_completed_customer
```

**Category:** Utility  
**Language:** English

**Body (copy-paste)**

```
Hello {{1}}, service request {{2}} is completed. Summary: {{3}}. Amount due: {{4}}. Please keep this message for your records.
```

| Variable | Meaning | Sample for Meta review |
|----------|---------|------------------------|
| `{{1}}` | Customer name | Ramesh Kumar |
| `{{2}}` | Ticket number | ST-1042 |
| `{{3}}` | Work summary | Calibration done, load cell OK |
| `{{4}}` | Amount due (or “Nil”) | INR 2500 |

---

## Template 5 — Payment due (customer)

**Template name**

```
payment_due_customer
```

**Category:** Utility  
**Language:** English

**Body (copy-paste)**

```
Hello {{1}}, balance due for service {{2}} is {{3}}. Reference: {{4}}. Please complete payment at your earliest convenience.
```

| Variable | Meaning | Sample for Meta review |
|----------|---------|------------------------|
| `{{1}}` | Customer name | Ramesh Kumar |
| `{{2}}` | Ticket / job ref | ST-1042 |
| `{{3}}` | Amount due | INR 1500 |
| `{{4}}` | Invoice / receipt ref | INV-0091 |

---

## Template 6 — Payment received (customer)

**Template name**

```
payment_received_customer
```

**Category:** Utility  
**Language:** English

**Body (copy-paste)**

```
Hello {{1}}, we have received payment of {{2}} for {{3}}. Reference: {{4}}. Thank you for choosing {{5}}.
```

| Variable | Meaning | Sample for Meta review |
|----------|---------|------------------------|
| `{{1}}` | Customer name | Ramesh Kumar |
| `{{2}}` | Amount paid | INR 2500 |
| `{{3}}` | Ticket / invoice label | ST-1042 |
| `{{4}}` | Receipt / invoice number | INV-0091 |
| `{{5}}` | Company name | HMS Enterprises |

---

## Template 7 — Sale enquiry received (customer)

**Template name**

```
sale_enquiry_received
```

**Category:** Utility  
**Language:** English

**Body (copy-paste)**

```
Hello {{1}}, we received your enquiry for {{2}}. Reference: {{3}}. Our sales executive will contact you shortly. Thank you — {{4}}.
```

| Variable | Meaning | Sample for Meta review |
|----------|---------|------------------------|
| `{{1}}` | Customer name | Meena Krishnan |
| `{{2}}` | Product interest | Truck Scale |
| `{{3}}` | Enquiry / lead ref | LE-2201 |
| `{{4}}` | Company name | HMS Enterprises |

---

## Template 8 — Demo started / delivery challan (customer)

**Template name**

```
demo_dc_customer
```

**Category:** Utility  
**Language:** English

**Body (copy-paste)**

```
Hello {{1}}, demo unit {{2}} (serial {{3}}) is issued under challan {{4}}. Our executive {{5}} will follow up on the demo. Thank you.
```

| Variable | Meaning | Sample for Meta review |
|----------|---------|------------------------|
| `{{1}}` | Customer name | Meena Krishnan |
| `{{2}}` | Product name | Platform 1T |
| `{{3}}` | Serial number | SN-77821 |
| `{{4}}` | DC number | DC-00012 |
| `{{5}}` | Sales executive name | Priya Venkatesh |

---

## Template 9 — Proforma ready (customer)

**Template name**

```
proforma_ready_customer
```

**Category:** Utility  
**Language:** English

**Body (copy-paste)**

```
Hello {{1}}, your proforma {{2}} for {{3}} is ready. Amount: {{4}}. Please contact {{5}} for next steps. Final tax invoice will be issued as per company process.
```

| Variable | Meaning | Sample for Meta review |
|----------|---------|------------------------|
| `{{1}}` | Customer name | Meena Krishnan |
| `{{2}}` | Proforma number | PI-00045 |
| `{{3}}` | Product / description | Truck Scale |
| `{{4}}` | Amount | INR 185000 |
| `{{5}}` | Company / billing contact | HMS billing desk |

---

## Template 10 — Sale converted / order confirmed (customer)

**Template name**

```
sale_order_confirmed
```

**Category:** Utility  
**Language:** English

**Body (copy-paste)**

```
Hello {{1}}, your order for {{2}} is confirmed. Reference: {{3}}. Our team will share proforma / delivery details next. Thank you — {{4}}.
```

| Variable | Meaning | Sample for Meta review |
|----------|---------|------------------------|
| `{{1}}` | Customer name | Meena Krishnan |
| `{{2}}` | Product | Animal Scale |
| `{{3}}` | Deal / lead ref | LE-2201 |
| `{{4}}` | Company name | HMS Enterprises |

---

## Event → template map (for CRM wiring)

| CRM event | Template name | Send to |
|-----------|---------------|---------|
| Service ticket created | `ticket_created_customer` | Customer |
| Service ticket created / assigned | `ticket_assigned_engineer` | Engineer |
| Ticket status changed | `ticket_status_update` | Customer |
| Service completed | `ticket_completed_customer` | Customer |
| Payment due / reminder | `payment_due_customer` | Customer |
| Marked paid | `payment_received_customer` | Customer |
| New sale enquiry | `sale_enquiry_received` | Customer |
| Demo + DC issued | `demo_dc_customer` | Customer |
| Lead converted / ready to buy | `sale_order_confirmed` | Customer |
| Proforma invoice created | `proforma_ready_customer` | Customer |

---

## Required details from your side

Fill this and share with the developer (keep secrets out of public chat / git).

### A. Meta / WhatsApp Cloud API credentials

| Field | Your value | Notes |
|-------|------------|-------|
| Business / brand display name | | e.g. HMS Enterprises |
| Meta Business Manager ID | | |
| WhatsApp Business Account ID (WABA ID) | | |
| Phone Number ID | | From WhatsApp → API setup |
| WhatsApp business phone (E.164) | | e.g. +91XXXXXXXXXX |
| Meta App ID | | developers.facebook.com |
| Meta App Secret | | Store securely |
| Permanent System User access token | | Needs `whatsapp_business_messaging` + `whatsapp_management` (or equivalent WhatsApp scopes) |
| Graph API version you use | | e.g. `v21.0` |
| Webhook callback URL | | Public HTTPS → CRM webhook |
| Webhook verify token | | You choose a random secret string |

### B. Approved templates checklist

After approval, paste Meta’s **exact** name + language:

| Template name | Language code | Status (Approved?) | Notes / body changes |
|---------------|---------------|--------------------|----------------------|
| `ticket_created_customer` | `en` | | |
| `ticket_assigned_engineer` | `en` | | |
| `ticket_status_update` | `en` | | |
| `ticket_completed_customer` | `en` | | |
| `payment_due_customer` | `en` | | |
| `payment_received_customer` | `en` | | |
| `sale_enquiry_received` | `en` | | |
| `demo_dc_customer` | `en` | | |
| `proforma_ready_customer` | `en` | | |
| `sale_order_confirmed` | `en` | | |

If Meta renames or rejects a template, update the name here — CRM must use the **approved** name.

### C. Business / CRM data readiness

| Requirement | Done? | Notes |
|-------------|-------|-------|
| Customer contacts have WhatsApp / mobile with country code (`91…`) | | |
| Engineers / desk users have mobile numbers in Users | | |
| Company legal / display name for `{{company}}` variables | | |
| Who receives engineer alerts if ticket unassigned? | | e.g. service desk group number |
| Prefer AskMeister bridge **or** direct Cloud API? | | CRM can support either |
| Test numbers for sandbox / live | | List 2–3 phones |

### D. Optional (AskMeister path)

If you send via AskMeister instead of calling Meta Graph directly:

| Field | Your value |
|-------|------------|
| AskMeister workspace URL | |
| AskMeister API key | |
| Phone Number ID (if required by AskMeister) | |
| AskMeister template IDs mapped to names above | |

### E. Go-live preferences

| Preference | Choice |
|------------|--------|
| Auto-send on ticket create (customer + engineer) | Yes / No |
| Auto-send on every status change | Yes / No (or only major statuses) |
| Auto-send proforma to customer | Yes / No |
| Auto-send sale enquiry ack | Yes / No |
| Quiet hours (no send overnight) | e.g. 9 AM – 8 PM IST |
| Fallback if template send fails | CRM notification only / `wa.me` link for staff |

---

## Important Meta rules (short)

1. **Utility** templates are for transactional updates only — no offers, discounts, or promo CTAs.
2. Outside the **24-hour** customer-reply window, you **must** use an approved template (not free text).
3. Variable values must not include newlines, excessive URLs, or policy-violating content.
4. Keep variable count low; Meta may reject bodies that look like marketing.
5. Numbers must be in international format when calling the API (e.g. `9198XXXXXXXX`).

---

## Next step after you fill Section A–C

1. Create & get **Approved** templates (1–10) in WhatsApp Manager.  
2. Share credentials (securely) + filled checklist.  
3. Dev wires CRM events → Cloud API `messages` endpoint with `type: template`.  

Document version: HMS / Nova CRM — Utility WhatsApp templates (copy-paste).
