---
name: mission-control-security-branch
description: The security hardening was merged into main on 2026-08-20 but its test suites have not been re-run since
metadata:
  type: project
---

The independent adversarial review's fixes (2 blockers, 6 majors — shell-metacharacter
sanitising in generated `track.py` commands, a server-side command allowlist,
non-reflecting CORS, fail-closed owner check, transactional ingest, `DEV_SKIP_AUTH`
removed from `.replit`) live in commit `c226763` and were **merged into `main` as `5ba70e4`
on 2026-08-20**. `main` is the head; branch new work from it.

**Why this is still worth remembering:** the merge is **typecheck-verified but not
test-verified**. `tsc --build --force` ran clean, but the DB-backed vitest suites could not
run on the machine that performed the merge (no pnpm, Node 20 vs the pinned 24, no
`DATABASE_URL`). So `main` has security changes on it whose tests nobody has re-run.

**How to apply:** run the api-server and dashboard suites before deploying `main` to the
Repl — that is the real gate, not the typecheck. If they fail, the merge reverts atomically
with `git revert -m 1 5ba70e4` (it was merged `--no-ff`, and contains no schema change);
the tag `pre-merge-security-2026-08-20` marks `main`'s pre-merge state. Read the review
findings from `git log -1 c226763` rather than re-deriving them. See
[[mission-control-hosting]].
