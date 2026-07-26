---
name: Ingest idempotency rules
description: Per-table upsert/replace semantics for POST /api/ingest
---

# Ingest idempotency rules

**Why:** The Mac push script can resend the same snapshot; the server must be safe to call repeatedly.

**How to apply:** In `artifacts/api-server/src/routes/ingest.ts`:

| Table | Semantic | Key |
|-------|----------|-----|
| applications | upsert | num |
| status_events | append-only, dedup via unique index on all 6 fields | ON CONFLICT DO NOTHING |
| queue_items | upsert, **preserve reviewed** (never update it on ingest) | url |
| eval_summaries | upsert | num |
| cover_letters | upsert | (num, file) |
| followups | **full replace** when key present (even as []) | — |
| reply_suggestions | **full replace** when key present (even as []) | — |
| ingest_snapshots | insert always, prune to last 30 | — |

Partial snapshots are allowed — a missing key means "don't touch that table", NOT "delete all rows".
`reviewed` on queue_items is a local flag that survives every re-ingest.
