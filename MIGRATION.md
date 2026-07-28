# Jarvis Mission Control — Migration & Self-Hosting Guide

This document covers everything needed to move the app off Replit, back it up,
restore it to a fresh environment, or run it on a self-hosted VPS.

---

## Environment variables

| Variable | Required in | Description |
|---|---|---|
| `DATABASE_URL` | Always | PostgreSQL connection string (e.g. `postgres://user:pass@host:5432/db`) |
| `INGEST_TOKEN` | Always | Bearer token your Mac push script uses for `POST /api/ingest` |
| `PORT` | Always | Port the API server binds to (set automatically by Replit; set manually on VPS) |
| `AUTH_MODE` | Optional | `replit` (default) or `basic` |
| `OWNER_USER_ID` | `AUTH_MODE=replit` | Your Replit numeric user ID (find it at `https://replit.com/@<you>`) |
| `SESSION_SECRET` | unused | Reserved; sessions use unsigned random-id cookies (32-byte sid), no signing needed |
| `REPL_ID` | `AUTH_MODE=replit` | Set automatically by Replit; OIDC redirect URI is derived from it |
| `AUTH_BASIC_USER` | `AUTH_MODE=basic` | Login username |
| `AUTH_BASIC_PASSWORD_HASH` | `AUTH_MODE=basic` | bcrypt hash of password (generate: see below) |
| `ALLOWED_ORIGINS` | Optional | Comma-separated origins allowed for CORS. Default: none (same-origin only — the dashboard is served by this server) |

### Generate a bcrypt password hash (basic mode)

```bash
node -e "const b=require('bcryptjs'); b.hash('your-password', 10).then(console.log)"
```

---

## Database backup and restore

### Backup (from Replit or any host)

```bash
# Full dump (schema + data)
pg_dump "$DATABASE_URL" --no-acl --no-owner -Fc -f jarvis-$(date +%Y%m%d).dump

# Plain SQL (human-readable)
pg_dump "$DATABASE_URL" --no-acl --no-owner -f jarvis-$(date +%Y%m%d).sql
```

### Restore to a new database

```bash
# From custom-format dump
pg_restore --no-acl --no-owner -d "$TARGET_DATABASE_URL" jarvis-20260727.dump

# From plain SQL
psql "$TARGET_DATABASE_URL" -f jarvis-20260727.sql
```

---

## Self-hosted VPS setup (AUTH_MODE=basic)

### 1. Create the database

```bash
createdb jarvis
export DATABASE_URL="postgres://postgres@localhost/jarvis"
```

### 2. Set environment variables

```bash
# /etc/environment or your deployment tool of choice
DATABASE_URL="postgres://user:pass@localhost:5432/jarvis"
INGEST_TOKEN="$(openssl rand -hex 32)"
AUTH_MODE="basic"
AUTH_BASIC_USER="admin"
AUTH_BASIC_PASSWORD_HASH="$(node -e "const b=require('bcryptjs'); b.hash('your-password', 10).then(console.log)")"
PORT=8080
```

### 3. Build and start

```bash
cd /path/to/workspace

# Install dependencies
pnpm install

# Build the API server
pnpm --filter @workspace/api-server run build

# Build the dashboard
pnpm --filter @workspace/dashboard run build

# Start (migrations run automatically on boot)
node artifacts/api-server/dist/index.js
```

### 4. Serve the dashboard

The dashboard builds to `artifacts/dashboard/dist/public/`. Serve it with nginx
or any static file server. The API server and the static dashboard can live on
the same host — configure nginx to proxy `/api/` to the API server and serve
everything else as static files.

```nginx
server {
    listen 443 ssl;
    server_name jarvis.yourdomain.com;

    # Static dashboard
    root /path/to/workspace/artifacts/dashboard/dist/public;
    try_files $uri $uri/ /index.html;

    # Proxy API calls
    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

> **Note:** In AUTH_MODE=basic, there is no Replit OIDC dependency, so the app
> works on any host without the `REPL_ID` or `OWNER_USER_ID` variables.

---

## Replit-specific items

| Item | Notes |
|---|---|
| `AUTH_MODE=replit` | Uses Replit OIDC (`https://replit.com/oidc`). OIDC redirect URI is auto-derived from `REPL_ID`. Not portable off Replit. |
| `OWNER_USER_ID` | Your Replit numeric user ID. Find it: open your profile at `https://replit.com/@<handle>`, run `fetch('/api/auth/me').then(r=>r.json()).then(d=>console.log(d.id))` in the browser console. |
| Session storage | Sessions stored in the `sessions` table (PostgreSQL). No in-memory session store — horizontal scaling safe. |
| Secrets | `INGEST_TOKEN` is stored as a Replit Secret and never checked into the repo. |
| Workflows | Two managed workflows: `API Server` (Express) and `Dashboard` (Vite). Replit starts them automatically. |

---

## First-time setup (Replit)

1. Fork or clone the repl.
2. Set secrets in the Replit Secrets panel:
   - `INGEST_TOKEN` — any random string (`openssl rand -hex 32`)
3. Set environment variables:
   - `OWNER_USER_ID` — your Replit user ID (see above)
4. Start the workflows. The API server runs `pnpm --filter @workspace/api-server run dev`.
5. Send your first ingest from the Mac:

```bash
curl -X POST https://<your-repl-domain>/api/ingest \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d @tracker-export.json
```

---

## Migration notes

- All schema migrations are `CREATE TABLE IF NOT EXISTS` — running the server on
  a new database automatically creates all tables on boot. No separate migration
  step needed.
- Adding a new table: add `CREATE TABLE IF NOT EXISTS ...` in
  `artifacts/api-server/src/lib/migrate.ts`. Migrations are idempotent and run
  on every boot.
- Column additions require a new `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`
  block in `migrate.ts`.

---

## Running tests

```bash
# All API server tests (vitest + supertest, real PostgreSQL)
pnpm --filter @workspace/api-server run test

# TypeScript type-check all packages
pnpm run typecheck:libs

# Regenerate Zod schemas + React Query hooks from the OpenAPI spec
pnpm --filter @workspace/api-spec run codegen
```
