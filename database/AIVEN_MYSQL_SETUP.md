# NovaCRM on Aiven MySQL

This guide walks through connecting NovaCRM to an Aiven MySQL 8 service using the schema in `novacrm_aiven_mysql_full.sql`.

## Prerequisites

- An Aiven account with a MySQL 8 service created
- MySQL client or MySQL Workbench (SSL required)
- Node.js 18+ for the backend

## 1. Get your Aiven MySQL connection details

1. Log in to [Aiven Console](https://console.aiven.io/).
2. Open your **MySQL** service.
3. Go to the **Overview** tab.
4. Under **Connection information**, note:
   - **Host** (e.g. `mysql-xxxxxxxx.aivencloud.com`)
   - **Port** (usually `PORT` from service info)
   - **User** (default user, often `avnadmin`)
   - **Password** (copy from service credentials)
   - **Database name** (default is often `defaultdb` — Aiven provisions this for you)

5. Download the CA certificate if prompted (recommended for strict SSL). Aiven provides a `ca.pem` under **Connection information → SSL mode**.

**Connection string format (URI):**

```text
mysql://USER:PASSWORD@HOST:PORT/DATABASE
```

For Prisma with strict SSL (recommended on Aiven):

```text
mysql://USER:PASSWORD@HOST:PORT/DATABASE?sslaccept=strict
```

If you use a CA file locally:

```text
mysql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=REQUIRED&sslcert=/path/to/ca.pem
```

**Example** (replace with your values):

```text
mysql://avnadmin:YOUR_PASSWORD@mysql-abc123.aivencloud.com:12345/defaultdb?sslaccept=strict
```

> **Tip:** Special characters in the password must be URL-encoded in `DATABASE_URL` (e.g. `@` → `%40`, `#` → `%23`).

## 2. Run the schema SQL file

Aiven does **not** allow `CREATE DATABASE` or `DROP DATABASE`. The script uses your existing Aiven database.

### Option A — MySQL Workbench

1. Connect to your Aiven service (enable **Use SSL** / SSL mode Required).
2. Select your database in the schema list (e.g. `defaultdb`).
3. **File → Open SQL Script** → choose `database/novacrm_aiven_mysql_full.sql`.
4. Execute the script.

Alternatively, uncomment and set in the script:

```sql
USE your_aiven_database;
```

### Option B — mysql CLI

From the project root:

```bash
mysql -h HOST -P PORT -u USER -p --ssl-mode=REQUIRED DATABASE \
  < database/novacrm_aiven_mysql_full.sql
```

The script is safe to re-run: tables use `CREATE TABLE IF NOT EXISTS`, and seed rows use `INSERT IGNORE`.

**After the script:**

| Item | Value |
|------|--------|
| Platform admin email | `admin@novacrm.com` |
| Platform admin password | `Admin@Nova2026` |

The SQL seed inserts a placeholder bcrypt hash. The backend seed (`prisma:seed`) replaces it with a real hash and creates the demo tenant.

## 3. Switch Prisma to MySQL

Edit `backend/prisma/schema.prisma`:

```prisma
datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}
```

### Timestamptz → DateTime conversion

The current Prisma schema targets PostgreSQL and uses `@db.Timestamptz(3)` on many fields. MySQL does not support `Timestamptz`. **Before** `prisma generate`, replace every occurrence:

| PostgreSQL (current) | MySQL (required) |
|------------------------|------------------|
| `@db.Timestamptz(3)` | `@db.DateTime(3)` |

You can do a project-wide find/replace in `schema.prisma`:

- Find: `@db.Timestamptz(3)`
- Replace: `@db.DateTime(3)`

Other native types (`@db.Char`, `@db.VarChar`, `@db.Decimal`, `@db.Date`, `@db.Text`, `@db.Json`) already align with the MySQL schema.

**Note:** Prisma models do not yet include `tenant_subscriptions`, `teams`, `team_members`, `deal_stage_history`, or `files`. Those tables are created by the SQL file and are used by the application schema; they do not require Prisma models unless you add them later.

## 4. Configure backend `.env`

In `backend/.env`:

```env
DATABASE_URL="mysql://USER:PASSWORD@HOST:PORT/DATABASE?sslaccept=strict"
PLATFORM_ADMIN_EMAIL=admin@novacrm.com
PLATFORM_ADMIN_PASSWORD=Admin@Nova2026
```

Keep other variables (`JWT_*`, `CLIENT_URL`, etc.) as in `.env.example`.

## 5. Generate Prisma client

```bash
cd backend
npm run prisma:generate
```

## 6. Seed demo data

```bash
npm run prisma:seed
```

This step:

- Upserts the platform admin with a valid bcrypt password
- Creates the **Precision Scales** demo tenant (weighing machines category)
- Seeds users, leads, deals, products, inventory, and related CRM/ERP sample data

**Demo tenant login** (after seed):

| Field | Value |
|-------|--------|
| Email | `demo@precisionscales.in` |
| Password | `Demo@12345` |

## 7. Start the backend

```bash
npm run dev
```

## Troubleshooting

| Issue | What to try |
|-------|-------------|
| SSL connection error | Use `?sslaccept=strict` or `ssl-mode=REQUIRED` with Aiven CA cert |
| `Access denied` | Verify user, password (URL-encoded in `DATABASE_URL`), and database name |
| `Table already exists` | Normal on re-run; `IF NOT EXISTS` skips creation |
| Login fails for platform admin | Run `npm run prisma:seed` to refresh the password hash |
| Prisma type errors on generate | Ensure all `@db.Timestamptz(3)` are changed to `@db.DateTime(3)` |
| Missing tables in Prisma Studio | Tables without Prisma models (e.g. `files`) exist in MySQL but won’t appear in Studio until models are added |

## File reference

| File | Purpose |
|------|---------|
| `database/novacrm_aiven_mysql_full.sql` | Aiven-safe full schema + platform seed |
| `database/novacrm_mysql_schema.sql` | Local MySQL reference (creates `novacrm` database) |
| `backend/prisma/schema.prisma` | Prisma models (switch provider + DateTime types for MySQL) |
| `backend/prisma/seed.ts` | Demo tenant and admin seed |

## Optional: push schema instead of SQL file

If you prefer Prisma to manage DDL after switching to MySQL:

```bash
npm run prisma:push
```

For production Aiven deployments, prefer the SQL file for a known, reviewable baseline; use `db push` mainly for local iteration once models match the database.
