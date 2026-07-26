# Jarvis Mission Control — Self-Host Migration Guide

This document describes how to run the app on your own VPS or server
instead of Replit. The only moving parts are Node.js, PostgreSQL,
and environment variables.

---

## Requirements

| Component | Version |
|-----------|---------|
| Node.js   | ≥ 22    |
| pnpm      | ≥ 10    |
| PostgreSQL | ≥ 15   |

---

## 1. Clone and install

```bash
git clone <your-fork>
cd jarvis
pnpm install
```

---

## 2. Provision PostgreSQL

Create a dedicated database and user:

```sql
CREATE DATABASE jarvis;
CREATE USER jarvis_user WITH PASSWORD 'strong-password';
GRANT ALL PRIVILEGES ON DATABASE jarvis TO jarvis_user;
```

---

## 3. Environment variables

Create a `.env` file (never commit it):

```env
# Required
DATABASE_URL=postgres://jarvis_user:strong-password@localhost:5432/jarvis
INGEST_TOKEN=<long-random-secret>    # used by the Mac push script
PORT=3001

# Auth mode — choose one
AUTH_MODE=basic                        # for self-host (no Replit OIDC)
AUTH_BASIC_USER=admin
AUTH_BASIC_PASSWORD_HASH=<bcrypt-hash> # generate below

# Optional — only needed in AUTH_MODE=replit
# SESSION_SECRET=<random>
# OWNER_USER_ID=<your-replit-user-id>
# ISSUER_URL=https://replit.com/oidc
# REPL_ID=<your-repl-id>
```

**Generate a bcrypt hash for AUTH_BASIC_PASSWORD_HASH:**

```bash
node -e "
const bcrypt = require('bcryptjs');
bcrypt.hash('your-password', 12).then(h => console.log(h));
"
```

**Generate INGEST_TOKEN:**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 4. Schema migrations

Migrations run automatically on every server start (additive only —
`CREATE TABLE IF NOT EXISTS`). No manual steps required.

```bash
# Build and start
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server run start
```

The server will log `Database migrations complete` on first boot and on
every subsequent start without any destructive change.

---

## 5. Mac push-script setup

In your Mac pipeline script, set:

```bash
export JARVIS_URL=https://your-vps-domain/api
export INGEST_TOKEN=<same-value-as-server>
```

Then POST the §5 payload:

```bash
curl -X POST "$JARVIS_URL/ingest" \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d @/tmp/snapshot.json
```

---

## 6. Staying up to date

- Only additive DB changes are made (new columns use defaults, new tables
  are created via IF NOT EXISTS). No destructive migrations.
- After pulling updates, rebuild and restart — migrations run automatically.
- Never delete or rename a column; add new ones instead.

---

## 7. AUTH_MODE reference

| Mode | When to use | Required env vars |
|------|-------------|-------------------|
| `replit` | Hosted on Replit | `REPL_ID`, `OWNER_USER_ID`, `SESSION_SECRET` |
| `basic`  | Self-hosted VPS  | `AUTH_BASIC_USER`, `AUTH_BASIC_PASSWORD_HASH` |

The `INGEST_TOKEN` is always required regardless of auth mode.
