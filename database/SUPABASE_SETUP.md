# NovaCRM → Supabase (no Direct connection needed)

Your project is Healthy. Do these 3 steps.

---

## Step A — Create all tables (in browser)

1. Open your Supabase project  
2. Left sidebar → **SQL Editor** → **New query**  
3. Open this file on your Mac and **copy everything**:

   `database/novacrm_supabase_schema.sql`

4. Paste into the SQL Editor → click **Run**  
5. You should see success (many CREATE TABLE statements)

Optional check: **Table Editor** — you should see tables like `tenants`, `leads`, `products`, etc.

---

## Step B — Paste Transaction pooler URL (recommended for NovaCRM API)

For the Express + Prisma API, use the **Transaction pooler** (port **6543**) so dev restarts and multiple tabs do not exhaust Supabase session connections.

1. Supabase → **Connect** → **Transaction pooler** (port **6543**, host `pooler.supabase.com`)
2. Copy the URI and add query params for Prisma + PgBouncer:

```text
postgresql://postgres.YOUR_PROJECT_REF:YOUR_PASSWORD@aws-0-....pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1&pool_timeout=20
```

3. Paste into `backend/.env`:

```env
DATABASE_URL="postgresql://postgres.xxxx:YOUR_PASSWORD@aws-0-....pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1&pool_timeout=20"
```

**Tip:** Run only **one** `npm run dev` for the backend. Multiple `tsx watch` processes each hold a DB connection and can cause “max clients reached” or empty lists in the UI.

Session pooler (port 5432) works for one-off seeds but is easier to overload during development.

---

## Step C — Tell me

Reply: **“pooler is in .env”**

I’ll seed demo data and start the API (no Direct connection, no MySQL).

---

### Logins after seed

| Role | URL | Creds |
|------|-----|--------|
| Super Admin | `/admin` | `admin@novacrm.com` / `Admin@Nova2026` |
| Demo client | `/login` | slug `precision-scales-india` · `demo@precisionscales.in` / `Demo@12345` |
