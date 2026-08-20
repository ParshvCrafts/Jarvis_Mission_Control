---
name: mission-control-hosting
description: Jarvis Mission Control is Replit-hosted; all env values live in Replit Secrets and never on disk
metadata:
  type: project
---

Jarvis Mission Control runs on Replit (Postgres 16 + nodejs-24 per `.replit`). There is
no `.env` file anywhere in the repo or on the developer machine — every environment
value (`DATABASE_URL`, `INGEST_TOKEN`, `OWNER_USER_ID`) is set in the Replit Secrets
panel only. `DATABASE_URL` and `PORT` are injected by Replit automatically.

**Why:** a local clone will typecheck (`tsc --build` works standalone) but cannot boot or
run the DB-backed vitest suites without a Postgres URL, so "it doesn't run locally" is
expected, not a broken checkout. Recreating the app elsewhere is config-only —
`MIGRATION.md` covers the `AUTH_MODE=basic` VPS path.

**How to apply:** never add a `.env` to this repo or suggest committing one. To change an
env value, change it in Replit Secrets. Before claiming a runtime bug, confirm whether
the code path was exercised on Replit or only locally. See [[mission-control-mac-push-seam]].
