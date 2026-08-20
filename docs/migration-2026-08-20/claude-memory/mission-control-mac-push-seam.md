---
name: mission-control-mac-push-seam
description: The Mac-side push script reads DASHBOARD_URL/DASHBOARD_INGEST_TOKEN from the real shell env, not from Jarvis/.env
metadata:
  type: project
---

Data reaches Mission Control only when the Mac pushes it: `Personal/Jarvis` →
`services/apply/scripts/push_dashboard.py` → `POST /api/ingest`. That script reads
`DASHBOARD_URL` and `DASHBOARD_INGEST_TOKEN` from the **process environment** and does
not call `load_dotenv()`.

**Why:** the token value is stored in `Personal/Jarvis/.env` under the *different* names
`REPLIT_INGEST_TOKEN` / `REPLIT_OWNER_USER_ID`, so having a populated `.env` is not
enough — a push will fail with `DASHBOARD_URL is not set` until the two `DASHBOARD_*`
names are exported in the shell. On the returned Mac they were absent from `~/.zshrc`,
so the connection was only ever made in ad-hoc shell sessions.

**How to apply:** when a push fails, check `printenv DASHBOARD_URL DASHBOARD_INGEST_TOKEN`
before suspecting the server. The permanent fix is the two `export` lines in `~/.zshrc`
(step 3 of `Jarvis/docs/redesign/GUIDE-mission-control-connect.md`). See
[[mission-control-hosting]].
