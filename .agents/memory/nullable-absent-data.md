---
name: Nullable-means-absent data rule
description: How to represent missing ingest data (e.g. queue score) so the UI never shows fake 0.0 values
---

# Nullable-means-absent data rule

The rule: when an ingest payload omits a numeric field, store NULL — never default to 0. Zero is a legitimate value and cannot double as "absent".

**Why:** Queue score badges showed misleading red "0.0" for 500 seeded items because the ingest zod schema defaulted missing score to 0 and the DB column was NOT NULL DEFAULT 0.

**How to apply:**
- Zod ingest schema: `z.number().nullable().default(null)` for optional numerics.
- DB column: nullable, no default; migration runner uses additive `ALTER COLUMN ... DROP NOT NULL / DROP DEFAULT` (idempotent, safe on every boot).
- OpenAPI 3.1: `type: [number, "null"]` (keep field required; null-able ≠ optional). Orval regenerates clients fine with this.
- UI: render a neutral "—" placeholder when null instead of formatting the number.
- Sorting: Postgres `ORDER BY col DESC` puts NULLs first — use `DESC NULLS LAST` when sorting by a nullable score.
