# Jarvis Mission Control

Single-user dashboard for visualising a job-application pipeline.
Data lives on the owner's Mac as JSON/TSV; the server ingests push
snapshots and **never writes back automatically**. Any edits generate
copy-pasteable CLI commands. No LLM, no email, no auto-apply.

---

## Architecture

```
Mac (source of truth)
  └─ push script → POST /api/ingest (bearer token)
                       │
                       ▼
             PostgreSQL (Replit DB)
                       │
                       ▼
              Express API server     ←─ React dashboard (browser)
              (artifacts/api-server)    (artifacts/dashboard)
```

---

## Monorepo structure

| Path | Purpose |
|------|---------|
| `artifacts/api-server` | Express 5 API server |
| `artifacts/dashboard`  | React + Vite frontend |
| `lib/db`               | Drizzle ORM schema + pool |
| `lib/api-zod`          | Generated Zod schemas + React Query hooks |
| `lib/api-spec`         | OpenAPI spec (source of truth for codegen) |

---

## Key doctrine

- **Mac is always the source of truth.** The server never mutates pipeline
  data on its own — only ingests what the Mac pushes.
- **Absent rows are preserved.** A key missing from a snapshot ≠ deletion.
  Applications, queue items, evals, covers, and status events are never
  deleted on ingest.
- **followups and reply_suggestions are computed snapshots.** When the key
  is present in the payload (even as `[]`), the table is fully replaced.
- **reviewed flag is local.** `queue_items.reviewed` survives re-ingest.
- **Migrations are additive only.** `CREATE TABLE IF NOT EXISTS`, new
  columns with defaults. Never drop/rename columns once data exists.
- **No LLM, no email, no cron, no external writes** in the server.

---

## §5 Data contract

`payload_version` must equal `1`. All top-level array keys are optional
(partial snapshots allowed). The `followups` and `reply_suggestions` keys
trigger full-replace when present.

Status enum values: `evaluated | applied | oa | responded | interview |
offer | hired | rejected | discarded | withdrawn`

Top-level payload keys:

| Key | Type | Semantics |
|-----|------|-----------|
| `payload_version` | number | Must be `1` |
| `generated_at` | ISO 8601 string | Snapshot timestamp |
| `applications` | array | Upserted by `num` |
| `status_events` | array | Appended (no delete) |
| `queue` | array | Upserted by `id` |
| `evals` | array | Upserted by `application_num` |
| `covers` | array | Upserted by `application_num` |
| `followups` | array | Full-replace when key present |
| `reply_suggestions` | array | Full-replace when key present |

---

## Auth modes

### `AUTH_MODE=replit` (default on Replit)

Replit OIDC via `openid-client` v6. Sessions stored in the `sessions`
table. After login, checks `req.user.id === OWNER_USER_ID` — any other
Replit account gets 403. See `artifacts/api-server/src/middlewares/authMiddleware.ts`.

**Finding your Replit user ID:** Open your profile at `https://replit.com/@<handle>`,
then run in the browser console:
```js
fetch('/api/auth/session').then(r=>r.json()).then(d=>console.log(d))
```
Or check the `/api/auth/me` endpoint after first login.

### `AUTH_MODE=basic` (for self-hosted VPS)

HTTP Basic auth. Credentials: `AUTH_BASIC_USER` + `AUTH_BASIC_PASSWORD_HASH`
(bcrypt). Constant-time comparison prevents timing leaks.

Generate the hash:
```bash
node -e "const b=require('bcryptjs'); b.hash('your-password', 10).then(console.log)"
```

### Ingest auth (both modes)

`POST /api/ingest` uses a bearer token (`INGEST_TOKEN`) — no session
required. Constant-time `crypto.timingSafeEqual` comparison.

---

## Required environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Always | PostgreSQL connection string |
| `INGEST_TOKEN` | Always | Bearer token for Mac push script |
| `PORT` | Always | Set by Replit automatically |
| `AUTH_MODE` | Optional | `replit` (default) or `basic` |
| `OWNER_USER_ID` | replit mode | Your Replit user ID |
| `SESSION_SECRET` | replit mode | Cookie signing secret (`openssl rand -hex 32`) |
| `REPL_ID` | replit mode | Set automatically by Replit |
| `AUTH_BASIC_USER` | basic mode | Login username |
| `AUTH_BASIC_PASSWORD_HASH` | basic mode | bcrypt hash of password |

---

## First-time setup (Replit)

1. Set secrets in the Replit Secrets panel:
   - `INGEST_TOKEN` — any random string: `openssl rand -hex 32`
   - `SESSION_SECRET` — any random string: `openssl rand -hex 32`
2. Set `OWNER_USER_ID` env var to your Replit user ID (find via browser console — see above).
3. Start the workflows. Schema migrations run automatically on boot.
4. Send your first ingest from the Mac:

```bash
curl -X POST https://<your-repl-domain>/api/ingest \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d @tracker-export.json
```

See `MIGRATION.md` for self-hosting on a VPS (AUTH_MODE=basic + nginx).

---

## Development commands

```bash
# Run the API server (dev mode — builds then starts)
pnpm --filter @workspace/api-server run dev

# Run all API tests (vitest + supertest, real PostgreSQL)
pnpm --filter @workspace/api-server run test

# Typecheck all packages
pnpm run typecheck:libs

# Push schema changes to the DB (Drizzle kit)
pnpm --filter @workspace/db run push

# Re-generate Zod schemas + React Query hooks from the OpenAPI spec
pnpm --filter @workspace/api-spec run codegen

# Performance seed (500 queue + 100 apps via ingest)
INGEST_TOKEN=<token> API_URL=http://localhost:8080 ./artifacts/api-server/node_modules/.bin/tsx scripts/perf-seed.ts
```

---

## Standing constraints

- Never auto-apply pending changes — only generate the CLI command string.
- Never call an LLM, send email, or trigger a cron from the server.
- Never delete an application row on ingest.
- Bump `payload_version` if the §5 contract changes; reject unknown majors
  with 422.
- Keep `reviewed` out of any ingest upsert (it's a local flag).
- All DB migrations must be `IF NOT EXISTS` — never destructive.
- No string interpolation into raw SQL — use Drizzle ORM or parameterized `client.query()`.

---

## User preferences

- Single-user app — no multi-tenancy, no role-based access.
- Copy-pasteable CLI commands only, no auto-apply.
- Dark mode UI preferred.
