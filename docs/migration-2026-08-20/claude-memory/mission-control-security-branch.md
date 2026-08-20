---
name: mission-control-security-branch
description: fix/security-review holds the hardening fixes and was still unmerged when the Mac was returned on 2026-08-20
metadata:
  type: project
---

As of 2026-08-20 the branch `fix/security-review` (commit `c226763`) is pushed to origin
but **not merged into `main`**. It carries the fixes for an independent adversarial review
(2 blockers, 6 majors): shell-metacharacter sanitising in generated `track.py` commands,
a server-side command allowlist, non-reflecting CORS, fail-closed owner check,
transactional ingest, and removal of `DEV_SKIP_AUTH` from `.replit`.

**Why:** `main` still contains the vulnerable command-generation path, so anything built
from `main` re-introduces the blockers. This is the first thing to resolve on the new
machine, before new feature work branches off `main`.

**How to apply:** treat `fix/security-review` as the true head. Branch new work from it,
or merge it to `main` first. Its own commit message is the review record — read it with
`git log -1 fix/security-review` rather than re-deriving the findings. See
[[mission-control-hosting]].
