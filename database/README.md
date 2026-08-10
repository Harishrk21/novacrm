# NovaCRM + NovaERP — MySQL Setup (Workbench)

## 1. Import the full schema

File to copy/run in MySQL Workbench:

**`database/novacrm_mysql_schema.sql`**

Steps:
1. Open MySQL Workbench → connect to your server
2. File → Open SQL Script → choose `novacrm_mysql_schema.sql`
3. Click the lightning bolt (Execute)
4. Confirm schema `novacrm` exists with all tables

This creates:
- Platform admin + business categories (industry templates)
- Multi-tenant clients (`tenants`) with module switches + terminology
- Custom field definitions (per business type)
- CRM: leads, contacts, accounts, deals, activities, tickets…
- ERP: products, warehouses, stock, POs, sales orders, invoices, payments, employees
- WhatsApp (AskMeister), automation, audit logs, number sequences
- Feature tips for guided UX
- Seed categories (Weighing Machines, Retail, Manufacturing, Services, Real Estate, Automotive, Healthcare, Education)

## 2. Backend `.env`

```bash
cd backend
cp .env.example .env
# edit DATABASE_URL=mysql://USER:PASSWORD@localhost:3306/novacrm
# ensure Redis is running: redis://localhost:6379
npm install
npx prisma generate
npx prisma db pull   # optional if you prefer introspecting Workbench schema
# OR keep prisma/schema.prisma in sync and:
# npx prisma db push
npm run prisma:seed
npm run dev
```

Seed creates:
- Platform admin: `admin@novacrm.com` / `Admin@Nova2026`
- Demo tenant: Precision Scales India (`precision-scales-india`)
- Tenant user: `demo@precisionscales.in` / `Demo@12345`

## Resume / day-to-day run

```bash
# Terminal 1 — API (needs MySQL + Redis running)
cd backend && npm run dev

# Terminal 2 — UI
cd .. && npm run dev
```

- Client login: http://localhost:5173/login  
- Platform admin: http://localhost:5173/admin  
- AskMeister webhook: `POST http://localhost:3001/api/integrations/whatsapp/webhook`

## 3. Architecture (enterprise pattern)

```
Platform Super Admin
   └── Business Categories (templates)
         └── Tenants / Clients
               ├── Modules enabled (CRM + ERP mix)
               ├── Terminology (Lead→Enquiry, etc.)
               ├── Custom fields (capacity_kg, machine_type…)
               ├── Users + RBAC
               ├── CRM data (tenant_id scoped)
               └── ERP data (tenant_id scoped)
```

Isolation: **shared MySQL schema + `tenant_id` on every business row** (Salesforce/Zoho-style SaaS). Redis caches list endpoints and tips.

## 4. Frontend routes

| Area | URL |
|------|-----|
| CRM app | `/` |
| Platform Admin | `/admin` (login: admin@novacrm.com) |
| Products | `/erp/products` |
| Inventory | `/erp/inventory` |
| Invoices | `/erp/invoices` |
| WhatsApp / AskMeister | `/whatsapp` |

## 5. Redis

Used for:
- Tenant module configs
- Lead/contact list cache invalidation
- Feature tips (10 min TTL)
- Rate-limit backing (optional)

If Redis is down, API still works (cache helpers fail open).
