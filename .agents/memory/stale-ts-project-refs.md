---
name: Stale TS project-reference declarations
description: Typecheck errors claiming schema columns don't exist usually mean lib/db dist .d.ts is stale
---

Rule: if `tsc` reports a column/property "does not exist" on a `@workspace/db` table that clearly exists in `lib/db/src/schema/`, rebuild the reference output first: `pnpm exec tsc -b lib/db --force`.

**Why:** api-server uses TS project references; imports of `@workspace/db` resolve to `lib/db/dist/*.d.ts` (composite, emitDeclarationOnly), which can lag behind schema source edits. This produced phantom errors ("rank does not exist", nullable column rejected as notNull) that looked like drizzle bugs.

**How to apply:** before working around such an error with casts or `sql` escapes, force-rebuild `lib/db` declarations and re-run typecheck.
