# NovaCRM Platform + HMS Enterprises workspace

Multi-tenant **CRM + ERP** platform. HMS Enterprises is the flagship company tenant (full service / stamping / AMC pack). Platform admins onboard additional clients without removing HMS features.

## Quick start

```bash
# UI
npm install && npm run dev

# API (separate terminal — after MySQL schema + optional Redis)
cd backend && cp .env.example .env   # set DATABASE_URL, JWT secrets, PLATFORM_ADMIN_*
npm install && npx prisma generate && npm run prisma:seed && npm run dev
```

- Company app: http://localhost:5173/login  
  - `admin@hmsenterprises.in` / `Demo@12345` (also `sales@` / `desk@` / `engineer@` / `warehouse@hmsenterprises.in`)  
- **Platform master console:** http://localhost:5173/login?mode=platform → `/admin`  
  - Email/password from `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` in `backend/.env`  
  - Default example: `admin@novacrm.com` / `Admin@Nova2026` (change in production)  
- Company Setup (Zoho-style hub): `/setup` (company admin)  
- AskMeister webhook: `POST /api/integrations/whatsapp/webhook`  
- Meta Cloud webhook: `GET|POST /api/integrations/whatsapp/cloud/webhook`  

## MySQL schema (Workbench)

Copy & run this file in MySQL Workbench:

➡️ **`database/novacrm_mysql_schema.sql`**

Prefer **`database/rds/02_schema.sql`** when aligning with the current Prisma models (includes `customer_assets`, `stock_units`, etc.).

Full instructions: **`database/README.md`**

## Backend (Phase 2 API)

```bash
cd backend
cp .env.example .env   # set DATABASE_URL + REDIS_URL (or REDIS_URL=none)
npm install
npx prisma generate
npm run prisma:seed
npm run dev            # :3001
```

Requires: MySQL 8+. Redis optional.

## What’s included

| Layer | Capability |
|-------|------------|
| Platform Admin | Create/suspend clients, business categories, tips, plans |
| Business templates | Weighing Machines (HMS pack), Retail, … |
| CRM | Leads, Contacts, Accounts, Deals, Activities, Tickets, WhatsApp |
| HMS ops | AMC, Stamping, demo stock, service proforma |
| ERP | Products, Inventory, Purchase Orders, Invoices |
| Setup | Zoho-style Setup Home + Settings tabs |
| Permissions | Role-based API permissions (users, products, invoices, accounts, …) |
| Data | `tenant_id` isolation, custom fields JSON, Redis cache (optional) |
