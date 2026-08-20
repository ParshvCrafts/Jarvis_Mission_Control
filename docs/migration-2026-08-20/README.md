# Migration bundle — 2026-08-20

Verbatim copies of off-repo state from the MacBook being returned, committed so the new
laptop can restore it. **This is a payload directory, not documentation** — the
instructions for using it are in [`../OFF-REPO-STATE.md`](../OFF-REPO-STATE.md).

## Manifest

| Path | Source on the Mac | Restore per |
|---|---|---|
| `claude-global/CLAUDE.md` | `~/.claude/CLAUDE.md` | OFF-REPO-STATE §4 — copy as-is |
| `claude-global/settings.json` | `~/.claude/settings.json` | OFF-REPO-STATE §4 — **merge, do not blind-copy** (machine-specific paths) |
| `claude-global/rules/amazon-production-safety-do-not-delete.md` | `~/.claude/rules/` | OFF-REPO-STATE §4 — copy as-is |
| `claude-global/rules/amazon-builder-context-do-not-delete.md` | `~/.claude/rules/` | OFF-REPO-STATE §4 — copy as-is |
| `claude-memory/MEMORY.md` + 3 memory files | newly written for this handoff | OFF-REPO-STATE §1b — copy into `~/.claude/projects/<mangled>/memory/` |

## Two things this bundle deliberately does not contain

- **No secrets.** Not one value. Every environment variable name and its source is listed
  in OFF-REPO-STATE §2; the values come from the Replit Secrets panel and
  `Personal/Jarvis/.env`. Never add a secret to this directory.
- **No global skills.** `~/.claude/skills/` held 24 design/animation skills, all
  marketplace-installed and none needed for this project. Restoring `settings.json`'s
  plugin entries brings the plugin-provided ones back; the standalone ones are listed by
  name in OFF-REPO-STATE §4a for on-demand reinstall.

## Note on the per-project memory

The Mac's `~/.claude/projects/-Users-parshvmp-Personal-Jarvis-Mission-Control/memory/` was
**empty** — nothing was lost. This project's durable knowledge lives in
[`../../.agents/memory/`](../../.agents/memory/) inside the repo (the Replit agent's
convention), which is already committed. The three files in `claude-memory/` here were
written fresh for this handoff and cover only the facts that are *not* derivable from the
repo: Replit hosting, the Mac push-seam env-name mismatch, and the fact that the merged
security hardening has not had its test suites re-run.
