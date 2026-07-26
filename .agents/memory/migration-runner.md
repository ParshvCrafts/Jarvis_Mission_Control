---
name: Migration runner pattern
description: How DB migrations are run on boot in the api-server
---

# Migration runner pattern

**Why:** Production deployments need schema to be created on first boot without manual steps. Drizzle push is dev-only.

**How to apply:**
- `artifacts/api-server/src/lib/migrate.ts` — `runMigrations()` function.
- Uses `pool` from `@workspace/db` (don't import `pg` directly — it's not a direct dep of api-server).
- All statements are `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` — never destructive.
- Called from `artifacts/api-server/src/index.ts` before `app.listen()`.
- If migration fails, server exits with code 1 (fail-fast).
- The Drizzle schema (`lib/db/src/schema/`) must stay in sync with the raw SQL in `migrate.ts`. When adding a table, update both.
