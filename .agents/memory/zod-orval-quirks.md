---
name: Zod v4 path and Orval quirks
description: How to import Zod v4 API in this project and what breaks Orval codegen
---

# Zod v4 path and Orval quirks

**Why:** The workspace uses `zod: ^3.25.76` which bundles the v4 API at `zod/v4`. Orval generates code using `zod.url()` for `format: uri` fields, but `zod.url()` doesn't exist in the Zod v3 root export — only in the v4 path.

**How to apply:**
- In any hand-written Zod schema: `import { z } from "zod/v4"` (NOT `from "zod"`).
- In OpenAPI spec: **never use `format: uri`** on any field. Remove it to prevent Orval from emitting `zod.url()` which fails typecheck.
- After any OpenAPI spec change: run `pnpm --filter @workspace/api-spec run codegen` and check for TS errors.
