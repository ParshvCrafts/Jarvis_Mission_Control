# Off-repo state — everything this laptop held that git cannot carry

**Written** 2026-08-20 on the MacBook being returned.
**Audience** the **agent** on the new laptop. This file is written to be *executed*, not
just read. Work top to bottom. Each section says who acts — **you** (the agent) or the
**owner** (the human, because it needs a password manager or a browser login).
**Companion** [HANDOFF-2026-08-20.md](HANDOFF-2026-08-20.md) for what the work *is*. This
file is only about what git leaves behind.

---

## 0. Why this file exists, and the honest inventory

Four kinds of state live outside this repo. Here is exactly what happens to each:

| Kind | Where it lived on the Mac | Carried in this repo? |
|---|---|---|
| 1. Global Claude instructions + settings | `~/.claude/CLAUDE.md`, `~/.claude/settings.json`, `~/.claude/rules/` | **yes** — verbatim copies in [`migration-2026-08-20/claude-global/`](migration-2026-08-20/claude-global/) |
| 2. Per-project agent memory | `~/.claude/projects/<mangled>/memory/` | **the Mac's copy was empty** — §1 explains why, and ships replacements |
| 3. Secrets | Replit Secrets panel + `Personal/Jarvis/.env` | **no, by design.** §2 lists every name and where to get the value |
| 4. Shell env for the Mac→dashboard push | `DASHBOARD_URL`, `DASHBOARD_INGEST_TOKEN` | **no** — §3. These were *never* in `~/.zshrc`; that is a real loose end |

**Nothing else.** Specifically checked and found to be non-issues:
- **No `.env` in this repo, and none ever existed.** A `find` for `.env*`, `*.pem`,
  `*secret*`, `*.local` across the whole tree returned nothing. Mission Control reads
  every value from Replit Secrets. Do not create one.
- **No project-level `.claude/` directory** in this repo, so no project settings, hooks,
  or permissions to port.
- **No launchd job, no cron entry** for Mission Control — the design forbids scheduling
  (PRD §8: "no background jobs, do not add cron/timers"). The two
  `~/Library/LaunchAgents/com.jarvis.email-*.plist` jobs belong to the *other* repo and are
  handled by `Personal/Jarvis/docs/redesign/MIGRATION-off-repo-state.md` §5. Do not
  recreate them from here.
- **No uncommitted or untracked source.** Working tree was clean; the only ignored files
  were `*.tsbuildinfo` build caches, which regenerate.

---

## 1. Agent memory — YOU restore this

### 1a. The situation, stated plainly

Claude Code's per-project memory directory on the Mac
(`~/.claude/projects/-Users-parshvmp-Personal-Jarvis-Mission-Control/memory/`) was
**empty**. Nothing was lost, because this project's durable knowledge was never kept
there — it lives in **[`.agents/memory/`](../.agents/memory/) inside the repo**, which is
the Replit agent's convention and is already committed and pushed. Seven memory files plus
an index are there and need no action.

So that Claude Code on the new laptop is not starting blind, three new memory files were
written for it, covering the facts that are *not* derivable from the repo:

| File | Fact it carries |
|---|---|
| `mission-control-hosting.md` | Replit-hosted; all env values in Replit Secrets; "won't run locally" is expected |
| `mission-control-mac-push-seam.md` | the push script reads the shell env, not `Jarvis/.env` — and the names differ |
| `mission-control-security-branch.md` | `fix/security-review` is the true head; `main` is still vulnerable |

### 1b. Install them

The target directory is derived from where you cloned the repo — the absolute path with
separators replaced by `-`. **Derive it, don't hardcode it.** If it doesn't exist yet, open
a Claude Code session in the repo once and it will appear.

```bash
# macOS / Linux — from the repo root
DEST="$HOME/.claude/projects/$(ls ~/.claude/projects/ | grep -i mission | head -1)/memory"
mkdir -p "$DEST"
cp docs/migration-2026-08-20/claude-memory/*.md "$DEST"/
ls "$DEST"      # expect 4 files: MEMORY.md + 3 memories
```

```powershell
# Windows PowerShell — from the repo root
$proj = (Get-ChildItem "$env:USERPROFILE\.claude\projects" | Where-Object Name -match 'mission' | Select-Object -First 1).FullName
$dest = Join-Path $proj 'memory'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item docs\migration-2026-08-20\claude-memory\*.md $dest
Get-ChildItem $dest
```

If `MEMORY.md` already exists at the destination, **merge** — append the three pointer
lines rather than overwriting someone else's index.

### 1c. Do not port `.agents/memory/`

It is already in the repo and the Replit agent reads it in place. Copying it into
`~/.claude/` would create a second copy that drifts.

---

## 2. Secrets — the OWNER must re-enter these. YOU cannot.

No secret value is in this repo or in this document, and none should ever be added.
Below is every name, where the value lives, and how to regenerate it if it is gone.

### 2a. Replit Secrets (server side) — set in the Repl, not on the laptop

Open the Repl → **Tools → Secrets**. These should still be there; the Repl was never
deleted, so **most likely nothing needs re-entering here at all.** Verify rather than
assume:

| Name | Required | Where the value comes from |
|---|---|---|
| `INGEST_TOKEN` | always | already set in the Repl. Must match the Mac's `DASHBOARD_INGEST_TOKEN` (§3). Regenerate with `openssl rand -hex 32` — but if you rotate it, you **must** update §3 too, or pushes start 401-ing |
| `OWNER_USER_ID` | `AUTH_MODE=replit` | the owner's numeric Replit user ID. Since `fix/security-review`, a **missing** value 503s every request instead of silently admitting any Replit account — so if the dashboard returns 503 after migration, this is the cause |
| `DATABASE_URL` | always | injected by Replit automatically. Do not set by hand |
| `PORT` | always | injected by Replit automatically. Do not set by hand |
| `ALLOWED_ORIGINS` | optional | leave unset. Only needed if the dashboard is ever served from a different host than the API. Default is same-origin |
| `AUTH_MODE` | optional | leave unset (defaults to `replit`). Set to `basic` only for the VPS path in [`MIGRATION.md`](../MIGRATION.md) |
| `AUTH_BASIC_USER` / `AUTH_BASIC_PASSWORD_HASH` | `AUTH_MODE=basic` only | not currently in use. Hash recipe is in [`MIGRATION.md`](../MIGRATION.md) |
| `SESSION_SECRET` | **unused** | documented as required in older notes; it is not. Sessions use unsigned 32-byte random-id cookies. Ignore it |

### 2b. Mac-side `.env` — lives in the *other* repo

`Personal/Jarvis/.env` is gitignored (correctly — it holds ~90 API keys) and holds the
three values that concern Mission Control:

| Key in `Jarvis/.env` | Corresponds to |
|---|---|
| `REPLIT_INGEST_TOKEN` | the Repl's `INGEST_TOKEN` |
| `REPLIT_OWNER_USER_ID` | the Repl's `OWNER_USER_ID` |
| `REPLIT_SESSION_SECRET` | nothing — vestigial, see `SESSION_SECRET` above |

**The full transport of that `.env` to the new machine is not this file's job** — it is
covered by `Personal/Jarvis/docs/redesign/MIGRATION-off-repo-state.md` §2/§4b, which the
owner already ran on 2026-08-19. Do that repo's migration first if it isn't done.

> **Owner, read this one:** the name mismatch is a trap. Having `REPLIT_INGEST_TOKEN`
> correctly set in `Jarvis/.env` does **not** make a push work, because the push script
> looks for `DASHBOARD_INGEST_TOKEN` in the shell and never reads `.env`. §3 is the fix.

---

## 3. The Mac→dashboard shell env — the real loose end

**Status on the returned Mac: not done.** `~/.zshrc` contained seven `JARVIS_*` exports
(`JARVIS_APPLY_DIR`, `JARVIS_COVERS_DIR`, `JARVIS_DISCOVERY_DIR`, `JARVIS_EVAL_DIR`,
`JARVIS_BROWSER_PROFILE_DIR`, `JARVIS_RESUME_STRUCTURE_DUMP`, `JARVIS_VAULT_MIRROR`) but
**neither `DASHBOARD_URL` nor `DASHBOARD_INGEST_TOKEN`**. Those exports are step 3 of
`Jarvis/docs/redesign/GUIDE-mission-control-connect.md` and they were only ever set inside
one-off shell sessions, if at all.

Consequence: pushes worked only in whichever terminal had them typed, and never after a
restart. Fix it permanently this time.

**OWNER action** (the token value must come from the Repl's Secrets panel or
`Jarvis/.env`; the agent should not handle it):

```bash
# macOS / Linux
cat >> ~/.zshrc <<'EOF'
export DASHBOARD_URL="https://YOUR-APP.replit.app"
export DASHBOARD_INGEST_TOKEN="PASTE-THE-INGEST_TOKEN-VALUE-HERE"
EOF
source ~/.zshrc
```

```powershell
# Windows — persist for the user, then restart the terminal
setx DASHBOARD_URL       "https://YOUR-APP.replit.app"
setx DASHBOARD_INGEST_TOKEN "PASTE-THE-INGEST_TOKEN-VALUE-HERE"
```

`DASHBOARD_URL` is the Repl's deployment URL (Replit → **Deploy/Deployments** → copy the
`https://….replit.app` URL). The temporary Webview dev URL also works but sleeps.

**Then verify — YOU can run this once the owner has set the values:**

```bash
printenv DASHBOARD_URL DASHBOARD_INGEST_TOKEN >/dev/null && echo "both set" || echo "MISSING"

cd <path-to>/Jarvis/services/apply
python3.11 scripts/push_dashboard.py --dry-run   # sends nothing
python3.11 scripts/push_dashboard.py             # real push
```

Expected: `Pushed to https://…: {'applications': N, 'queue': N, …}`, and the dashboard
populates. Failure modes and what each means are listed at the bottom of
`Jarvis/docs/redesign/GUIDE-mission-control-connect.md`.

---

## 4. Global Claude config — YOU restore, then the OWNER checks

Verbatim copies are committed in
[`migration-2026-08-20/claude-global/`](migration-2026-08-20/claude-global/):

| File | Notes before you copy it |
|---|---|
| `CLAUDE.md` | the owner's global working principles (tiered rigor, $0/OSS preference, mentor notes, commit-message rules). **Machine-independent — copy as-is.** |
| `settings.json` | model list, effort level, theme, and `enabledPlugins` / `extraKnownMarketplaces`. **Contains machine-specific absolute paths — see the warning below.** |
| `rules/amazon-production-safety-do-not-delete.md` | AWS production-safety rules. Machine-independent. |
| `rules/amazon-builder-context-do-not-delete.md` | Amazon-internal build-system context. Machine-independent. |

```bash
# macOS / Linux — from the repo root
mkdir -p ~/.claude/rules
cp docs/migration-2026-08-20/claude-global/CLAUDE.md      ~/.claude/CLAUDE.md
cp docs/migration-2026-08-20/claude-global/rules/*.md     ~/.claude/rules/
# settings.json — review first, do NOT blind-copy. See below.
```

> **Do not blind-copy `settings.json`.** Three of its values are specific to the returned
> Mac and will break or silently misbehave elsewhere:
> - `awsCredentialExport` and `statusLine.command` both hardcode
>   `/Users/parshvmp/.toolbox/bin/claude`. Re-point them at the new machine's toolbox path,
>   or drop both keys if the new laptop is not an Amazon-managed device.
> - `extraKnownMarketplaces.aim.source.path` is `/Users/parshvmp/.aim/cc-plugins`, a local
>   directory. It only resolves if the AIM toolbox is installed on the new machine.
>
> The safe move on a **personal** laptop: merge in only `model`, `availableModels`,
> `modelOverrides`, `fallbackModel`, `effortLevel`, `theme`, `includeCoAuthoredBy`, and the
> non-`aim` entries of `enabledPlugins`/`extraKnownMarketplaces`. On a replacement
> **Amazon** laptop, copy the whole file and fix the two paths.

`includeCoAuthoredBy: false` matters — the owner does not want agent-credit lines in
commit messages. Preserve it.

### 4a. Global skills — reinstall, don't copy

`~/.claude/skills/` held 24 design/animation skills. They are **not** copied into this
repo: they are large, they are not project-specific, and every one of them came from a
marketplace that `settings.json` already records. Restoring the plugin entries in §4 brings
back the plugin-provided ones (`ui-ux-pro-max`, `impeccable`, the official
`frontend-design` / `superpowers` / `skill-creator` / `code-review` / `playwright` /
`claude-code-setup` / `slack` plugins, and the composio pair).

For the record, the standalone ones present were: `brandkit`,
`design-motion-principles`, `design-taste-frontend` (+ `-v1`), `find-skills`,
`full-output-enforcement`, `gpt-taste`, `graphify`, `gsap-*` (core, frameworks,
performance, plugins, react, scrolltrigger, timeline, utils), `high-end-visual-design`,
`image-to-code`, `imagegen-frontend-mobile`, `imagegen-frontend-web`,
`industrial-brutalist-ui`, `minimalist-ui`, `redesign-existing-projects`,
`stitch-design-taste`. **None is required to work on this project** — reinstall on demand
via `/find-skills` or the plugin marketplace, not preemptively.

Note also: this repo ships nine of its own skills in [`.agents/skills/`](../.agents/skills/)
(`frontend-design`, `brainstorming`, `ui-ux-pro-max`, `web-design-guidelines`,
`audit-website`, `browser-use`, `remotion-best-practices`, `vercel-react-best-practices`,
`vercel-react-native-skills`). Those are committed and need no action.

---

## 5. Toolchain — YOU install

The returned Mac could not build the workspace: `pnpm` was not on its PATH and its Node
was 20 while `.replit` pins 24. Do not reproduce that.

| Tool | Needed | Note |
|---|---|---|
| Node.js | **24.x** | `.replit` declares `nodejs-24`. The Mac had 20 via `mise`, which is why `corepack pnpm` failed there |
| pnpm | any recent | required — `package.json`'s `preinstall` hard-fails any other package manager, and there is **no `packageManager` field**, so corepack won't auto-provision it. `npm i -g pnpm` |
| PostgreSQL | 16 | `.replit` declares `postgresql-16`. Only needed for running the DB-backed test suites locally; the app itself uses the Repl's DB |
| Python | **3.11** | for the Mac-side push script in the other repo (`python3.11`, not bare `python3`) |

```bash
node --version      # want v24.x
pnpm --version      # must resolve
pnpm install
pnpm run typecheck:libs
```

One repo-level quirk worth knowing before it surprises you: `pnpm-workspace.yaml` sets
`minimumReleaseAge: 1440` — a deliberate 1-day supply-chain-attack delay on new npm
releases, with an allowlist for `@replit/*`. **Do not disable it** to make an install go
through; the file's own comment explains why. Add to `minimumReleaseAgeExclude` only for a
trusted publisher, and remove the exclusion afterwards.

---

## 6. Accounts and services the OWNER must still be able to reach

Nothing here is code; it is access. Confirm each before assuming the project is portable.

| Service | What it holds | Check |
|---|---|---|
| **Replit** (Pro) | the running app, the PostgreSQL database, all Secrets | log in; open the Repl; confirm it still starts and Secrets are intact |
| **GitHub** `ParshvCrafts` | both repos | confirm push access from the new machine (SSH key or PAT is new-machine state, not in any repo) |
| **Replit deployment URL** | the `https://….replit.app` needed by §3 | copy it from Deploy/Deployments |

If the Replit Postgres is ever at risk, `MIGRATION.md` has the `pg_dump` / `pg_restore`
commands. **Taking a dump now, before decommissioning anything, is cheap insurance** —
the database is the only project state that exists in exactly one place.

---

## 7. Decommissioning the Mac — runs LAST

Only after §3's real push succeeds from the new machine, confirming the whole chain works
end-to-end:

1. Confirm `git log origin/main` and `git log origin/fix/security-review` on the new
   machine match what §3 of [HANDOFF-2026-08-20.md](HANDOFF-2026-08-20.md) records.
2. Confirm a real push populated the dashboard.
3. Only then wipe the Mac.

Credential revocation for the ~90 keys in `Jarvis/.env` is the *other* repo's §8 — that is
the higher-stakes list, and it must not be skipped just because this project's own secret
surface is small (one ingest token).

---

## 8. Checklist — tick these off

- [ ] Both repos cloned; `fix/security-review` checked out here (HANDOFF §4)
- [ ] §1 agent memory copied into `~/.claude/projects/<mangled>/memory/` (4 files)
- [ ] §4 global `CLAUDE.md` + `rules/` copied; `settings.json` merged **with paths fixed**
- [ ] §5 Node 24 + pnpm + Python 3.11 installed; `pnpm install` succeeds
- [ ] `pnpm run typecheck:libs` clean
- [ ] Full test suites re-run and matching HANDOFF §5's numbers
- [ ] §2a Replit Secrets verified present (especially `OWNER_USER_ID` — missing ⇒ 503)
- [ ] §3 `DASHBOARD_URL` + `DASHBOARD_INGEST_TOKEN` in the **shell profile**, not just a session
- [ ] §3 dry-run push, then real push, dashboard populates
- [ ] §6 Replit + GitHub access confirmed; `pg_dump` backup taken
- [ ] `fix/security-review` merged to `main` and redeployed (HANDOFF §4)
- [ ] Only then: §7 decommission
