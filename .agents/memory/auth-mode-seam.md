---
name: Auth mode seam
description: AUTH_MODE=replit vs basic; how the two modes differ and share req.user shape
---

# Auth mode seam

**Why:** App must work on Replit (Replit OIDC) and on a self-hosted VPS (HTTP Basic).

**How to apply:** Check `process.env.AUTH_MODE` (default: "replit").

- `authMiddleware` (session loader): no-op in basic mode — only loads OIDC session in replit mode.
- `requireAuth`: in replit mode checks `req.isAuthenticated()` + OWNER_USER_ID (403 if wrong user); in basic mode parses `Authorization: Basic` header and runs bcrypt.compare.
- Both modes set `req.user = { id, email, firstName, lastName, profileImageUrl }`.
- In basic mode: `id` is always `"basic-user"`, `email` is the username.
- INGEST_TOKEN bearer auth is independent of AUTH_MODE — always constant-time compared.
- The bcrypt dummy hash trick prevents timing leaks when the username doesn't match.
- Test with `AUTH_MODE=basic`, `AUTH_BASIC_USER`, `AUTH_BASIC_PASSWORD_HASH` env vars.
