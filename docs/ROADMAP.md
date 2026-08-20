# Roadmap — future plans and considered-but-unbuilt work

**Written** 2026-08-20, on the Mac being returned, so that no intended work is lost.
**Companions** [HANDOFF-2026-08-20.md](HANDOFF-2026-08-20.md) (current state),
[OFF-REPO-STATE.md](OFF-REPO-STATE.md) (migration steps).

Sources this was assembled from, so it can be audited rather than trusted:
- `Personal/Jarvis/docs/redesign/REPLIT_MISSION_CONTROL_PRD.md` — §13 "out of scope but
  planned", §14 portability, and the P1/P2 rows of §6
- the shipped code and test tree (what exists vs. what §10 of the PRD asked for)
- `MIGRATION.md` (the self-host path, already written and current)
- the review record in `git log -1 fix/security-review`

**Nothing here is started.** Everything in the list below is either explicitly deferred by
the PRD or a gap found while writing this handoff. Items are grouped by whether they are
blocking, and ordered within each group.

---

## 0. Do these first — they are not "future work", they are unfinished business

Listed here so they cannot be mistaken for optional. Details in
[HANDOFF-2026-08-20.md](HANDOFF-2026-08-20.md) §8.

1. **Merge `fix/security-review` into `main`.** `main` still contains the vulnerable
   command-generation path (2 blockers). HANDOFF §4.
2. **Re-run the full test suite on the new machine** and confirm the recorded numbers.
   HANDOFF §5.
3. **Persist the two `DASHBOARD_*` shell exports** so a push survives a new terminal, then
   do a real end-to-end push. [OFF-REPO-STATE.md](OFF-REPO-STATE.md) §3.

---

## 1. Deferred by the PRD (§13 "out of scope but planned — leave seams")

These were *deliberately* not built, with seams left in place. The seams exist; the work
does not.

### 1a. Response-rate significance testing — **frozen until n ≥ 25 applied**

PRD §13. The analytics page already computes response-rate splits by letter tone and by
resume-attached, and shows `n` on every split. What is missing is any statement of whether
a difference is *real* rather than noise.

- **Trigger:** ≥ 25 rows have entered `applied` (per `StatusEvent`). Below that, any test
  is theatre — which is exactly why the PRD froze it.
- **Scope when unfrozen:** a two-proportion comparison per split with a visible interval,
  not a bare p-value; keep the honest right-censoring the funnel already does (in-flight
  rows excluded from the denominator, shown as "n in flight").
- **Do not** let this become a reason to add a stats library. PRD §7 says clarity over
  decoration and §8 forbids chart-library bloat.

### 1b. Scheduled auto-ingest of email reply suggestions

PRD §13. Today, reply suggestions arrive only when the Mac pushes. The ingest endpoint
already accepts them, so **no server work is needed** — the schedule belongs on the Mac.

- **Constraint that must not be broken:** the server gets no cron, no timer, no background
  job (PRD §8, and `replit.md`'s standing constraints). If this is built, it is a launchd
  job in `Personal/Jarvis` that calls
  `push_dashboard.py --with-replies`, and nothing in this repo changes.
- Note the `Personal/Jarvis` repo already has launchd jobs for email triage
  (`com.jarvis.email-*.plist`), so the pattern to copy is right there.

---

## 2. Known gaps vs. the PRD's own requirements

Not "future ideas" — things the PRD asked for that were never delivered. Worth doing
before new features.

### 2a. Playwright E2E smoke test — **never written**

PRD §10 specified: *"seed → Today view renders all four cards → drag a board card →
pending tray shows the exact command → mark queue item reviewed → re-ingest → flag
persists."*

There is no Playwright dependency and no spec anywhere in the repo. Unit and API coverage
is solid (12 test files, including exact-string command-format tests); **browser-level
coverage is zero.** The drag-to-pending-change flow — the single most doctrine-critical
interaction in the app — has never been tested through a real browser.

This is the highest-value testing work available.

### 2b. Re-run the performance check

PRD §7 requires any view interactive in < 1s with 500 queue items / 100 applications, and
§10 requires generating that load *through the ingest endpoint*. The script exists —
`scripts/perf-seed.ts`, invocation documented in `replit.md`. Whether it has been run
against the current build is unknown, so treat the < 1s claim as unverified. Re-run it
after the new machine is set up; virtualize or paginate if it fails (`> 200` rows is the
PRD's stated threshold).

### 2c. Root `README.md`

PRD §9 stage 8 asked for a README with setup steps. The repo has `replit.md` (agent
doctrine) and `MIGRATION.md` (self-hosting) but **no README** — a fresh clone gives a
visitor no entry point. Small, cheap, and it makes the two documents that *do* exist
discoverable. Point it at `replit.md`, `MIGRATION.md`, and this `docs/` directory.

---

## 3. Planned platform move: self-host on a Linux VPS

PRD §14 made this a hard requirement *from day one*, and the seams were honoured:
`AUTH_MODE=basic` exists, is tested, and all DB access goes through `DATABASE_URL`.

**[`MIGRATION.md`](../MIGRATION.md) is already written and current** — env-var table,
`pg_dump`/`pg_restore` commands, bcrypt hash recipe, nginx reverse-proxy config, and the
note that migrations run automatically on boot.

- **Migration should be config-only, never surgery.** If it turns out to need code changes,
  that is a bug in the seam, not a migration task.
- Triggers to actually do it: Replit cost, Replit sleep latency, or wanting a custom
  domain. No trigger has fired.
- The `AUTH_MODE=basic` boot test already exists (strengthened by `fix/security-review`
  M5, which replaced a decorative test with a real 200/401/`WWW-Authenticate` e2e test), so
  the seam is proven before it is needed.

---

## 4. Lower-priority ideas that stayed on the shelf

Recorded for completeness. None is committed to; each has a reason it was not done.

- **Ingest-snapshot diffing.** The schema keeps the last 30 raw payloads
  (`ingest_snapshots`), which was designed for "history/diff" (PRD §5), but no diff view
  was built. Would answer "what changed since yesterday's push" without leaving the app.
- **Deeper season-calendar automation.** CSV import got substantial work (duplicate
  detection, per-row skip reasons, closest-date conflict targeting, bulk keep/apply with
  undo). What was never built: recurring-season templates, or importing directly from a
  URL. The PRD explicitly says pre-seed empty and *do not invent deadline data* — any
  automation here must keep the owner as the source of entries.
- **Mobile-native app.** Explicit non-goal (PRD §3). Responsive web is the answer; a
  mobile spot-check was in scope for the polish pass, a mobile app never was.

---

## 5. Permanently out of scope — do not "helpfully" add these

From PRD §3 non-goals and `replit.md`'s standing constraints. An agent with fresh context
will propose several of these; the answer is no, and the reason is architectural rather
than a matter of taste.

- **No auto-apply, no scraping, no job-board logins, no browser automation.**
- **No LLM calls anywhere in this app**, and no "AI insights" features. Every score and
  analysis is precomputed upstream on the Mac.
- **No email sending of any kind.**
- **No cron, timers, or background jobs** in the server.
- **No outbound HTTP from the server at all.** PRD §10's final review pass greps for this;
  the count must stay zero.
- **No multi-user support, roles, teams, sharing, or public pages.** Single user, forever.
- **No resume or cover-letter generation** — that lives upstream.
- **No write-back to the Mac.** Edits produce a copy-pasteable command; the human applies
  it. The app never emits `--force`.

If a future request seems to need one of these, that is a signal to re-read
[`replit.md`](../replit.md) and the PRD before writing code — the doctrine is the product,
not an obstacle to it.
