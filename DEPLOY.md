# Deploy NovaCRM — Vercel (frontend) + Render (backend)

Folder layout is already correct for a split deploy:

```
nova_crm/                 ← FRONTEND (Vite + React) → Vercel
  public/
  src/
  index.html
  package.json            npm run build → dist/
  vercel.json             SPA rewrites
  .env                    local only (do not commit secrets)

nova_crm/backend/         ← API (Express + Prisma) → Render
  prisma/
  src/
  package.json            npm run build → dist/
  .env                    never commit

nova_crm/database/        SQL dumps / docs — not deployed
```

| Piece | Host |
|--------|------|
| Frontend static `dist/` | **Vercel** |
| Backend Node API | **Render** (Web Service) |
| MySQL | Your **Aiven** DB (already in use) |

---

## Prerequisites

1. Code on **GitHub** (recommended: repo root = `nova_crm` folder).
2. Accounts: [vercel.com](https://vercel.com), [render.com](https://render.com).
3. Aiven MySQL URL that allows remote connections (`0.0.0.0/0` or Render IPs).

---

## Step 1 — Deploy backend on Render (do this first)

1. Open Render → **New** → **Web Service** → connect your GitHub repo.
2. Configure:

| Setting | Value |
|---------|--------|
| **Root Directory** | `backend` |
| **Runtime** | Node |
| **Build Command** | `npm install && npx prisma generate && npm run build` |
| **Start Command** | `npm start` |
| **Instance** | Free |

3. **Environment** (Render → Environment):

```env
DATABASE_URL=mysql://USER:PASSWORD@HOST:PORT/DB?ssl-mode=REQUIRED
PORT=10000
NODE_ENV=production
CLIENT_URL=https://YOUR-APP.vercel.app
JWT_ACCESS_SECRET=generate-a-long-random-string
JWT_REFRESH_SECRET=generate-another-long-random-string
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
PLATFORM_ADMIN_EMAIL=admin@novacrm.com
PLATFORM_ADMIN_PASSWORD=change-this-strong-password
UPLOAD_DIR=./uploads
REDIS_URL=none
```

Notes:
- Set `CLIENT_URL` to your real Vercel URL after Step 2 (you can update it).
- Free Render **sleeps** when idle — first request may take 30–60s.
- Redis is optional; `REDIS_URL=none` is fine.

4. Deploy → copy the service URL, e.g. `https://novacrm-api.onrender.com`
5. Check health: `https://novacrm-api.onrender.com/health`

Optional once (Render shell or local against Aiven):

```bash
cd backend
npx prisma db push
npm run prisma:seed
```

---

## Step 2 — Deploy frontend on Vercel

1. Open Vercel → **Add New Project** → import the same GitHub repo.
2. Configure:

| Setting | Value |
|---------|--------|
| **Root Directory** | `.` (project root = `nova_crm`, **not** `backend`) |
| **Framework Preset** | Vite |
| **Build Command** | `npm run build` |
| **Output Directory** | `dist` |
| **Install Command** | `npm install` |

3. **Environment Variables** (Production):

| Name | Value |
|------|--------|
| `VITE_API_URL` | `https://novacrm-api.onrender.com/api` |

Important: must end with `/api`.

4. Deploy → note URL, e.g. `https://nova-crm.vercel.app`

5. Go back to Render and set:

```env
CLIENT_URL=https://nova-crm.vercel.app
```

(Add comma-separated origins if you also use a custom domain.)

6. Redeploy backend (or restart) so CORS picks up the new origin.

---

## Step 3 — Verify

1. Open `https://YOUR-APP.vercel.app/login`
2. Platform: `admin@novacrm.com` / your platform password → should land on `/admin`
3. Sign out → must return to `/login` (not `/admin/login`)
4. Client: `demo@precisionscales.in` / `Demo@12345` → company dashboard
5. Employee: `karthik@precisionscales.in` / `Demo@12345` → Employee desk

---

## Folder checklist (yes / no)

| Path | Deploy? | Host |
|------|---------|------|
| `src/`, `public/`, `index.html`, `package.json` | Yes | Vercel |
| `backend/` | Yes | Render (Root Directory = `backend`) |
| `database/` | No | Keep as docs/SQL only |
| `backend/.env`, root `.env` | No | Set in host dashboards |

Structure is correct as-is. You do **not** need to merge frontend and backend into one app.

---

## Common issues

| Problem | Fix |
|---------|-----|
| CORS error in browser | `CLIENT_URL` on Render must exactly match the Vercel origin (`https://…`) |
| API 404 from frontend | `VITE_API_URL` must be `https://….onrender.com/api` then **rebuild** Vercel |
| Blank page on refresh (`/leads`) | `vercel.json` SPA rewrite is included — redeploy frontend |
| Uploads/images break | Render free disk is ephemeral; for production use S3/Cloudinary later |
| DB connection refused | Aiven firewall / SSL; allow public or Render egress |
| Cold start | Free Render sleeps; wait ~1 min on first hit |

---

## Local vs production env

| File | Purpose |
|------|---------|
| `nova_crm/.env` | Local: `VITE_API_URL=/api` + Vite proxy |
| Vercel env | Production: full Render API URL |
| `backend/.env` | Local secrets |
| Render env | Production secrets |

Never commit real `.env` files with passwords.
