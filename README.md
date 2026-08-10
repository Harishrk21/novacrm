# NovaCRM + NovaERP v2

Multi-tenant **CRM + ERP** platform. One product, many clients — each client gets modules, fields and language tailored to their industry (e.g. Weighing Machines).

## Quick start

```bash
# UI
npm install && npm run dev

# API (separate terminal — after MySQL schema + Redis)
cd backend && cp .env.example .env   # or edit existing .env
npm install && npx prisma generate && npm run prisma:seed && npm run dev
```

- CRM app: http://localhost:5173  
- Workspace login: http://localhost:5173/login  
  - slug `precision-scales-india` · `demo@precisionscales.in` / `Demo@12345`  
- Platform Admin: http://localhost:5173/admin  
  - `admin@novacrm.com` / `Admin@Nova2026`  
- AskMeister webhook: `POST /api/integrations/whatsapp/webhook`

## MySQL schema (Workbench)

Copy & run this file in MySQL Workbench:

➡️ **`database/novacrm_mysql_schema.sql`**

Full instructions: **`database/README.md`**

## Backend (Phase 2 API)

```bash
cd backend
cp .env.example .env   # set DATABASE_URL + REDIS_URL
npm install
npx prisma generate
npm run prisma:seed
npm run dev            # :3001
```

Requires: MySQL 8+, Redis.

## What’s included

| Layer | Capability |
|-------|------------|
| Platform Admin | Create/suspend clients, business categories, tips |
| Business templates | Weighing Machines, Retail, Manufacturing, Services, Real Estate, Auto, Healthcare, Education |
| CRM | Leads, Contacts, Accounts, Deals, Activities, Tickets, WhatsApp (AskMeister) |
| ERP | Products, Inventory, Purchase Orders, Invoices |
| UX | Day/night + palettes, tips on every major screen |
| Data | `tenant_id` isolation, custom fields JSON, audit logs, Redis cache |
# novacrm
