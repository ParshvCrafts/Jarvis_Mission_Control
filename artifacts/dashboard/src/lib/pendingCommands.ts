/**
 * Command string formatting for pending changes.
 * Mirrors the logic in artifacts/api-server/src/lib/ingestSchema.ts.
 * Both must stay in sync — change one, change both.
 */

/**
 * Neutralize untrusted text for use inside a quoted CLI argument.
 * Every shell-active character is REPLACED with a lookalike (not escaped —
 * escaping leaves backtick/backslash/! live when pasted into a shell;
 * security review B1). Mirrors sanitizeForCommand in
 * artifacts/api-server/src/lib/ingestSchema.ts — change one, change both.
 */
function sanitize(s: string): string {
  let out = s
    .replace(/[\r\n\t]/g, " ")
    .replace(/\|/g, "/")
    .replace(/[`"']/g, "'")
    .replace(/;/g, ",")
    .replace(/\$/g, "S")
    .replace(/\\/g, "/")
    .replace(/!/g, ".")
    .replace(/[&<>#*?~^(){}[\]]/g, " ");
  out = out.replace(/--force/g, "force").replace(/--yes/g, "yes");
  return out.replace(/\s+/g, " ").trim().slice(0, 120);
}

export type PendingKind = "status" | "note" | "contact" | "followup_done";

/**
 * Format a pending-change CLI command.
 *
 * status:       python3.11 scripts/track.py set {num} {value} --date {today}
 * note:         python3.11 scripts/track.py set {num} --note "{escaped}" --date {today}
 * contact:      python3.11 scripts/track.py contact {num} --contact "{escaped}"
 * followup_done: python3.11 scripts/track.py followup {num} --note "{escaped}"
 */
export function formatPendingCommand(
  kind: PendingKind,
  num: number,
  value: string,
  todayLADate: string,
): string {
  switch (kind) {
    case "status":
      return `python3.11 scripts/track.py set ${num} ${value} --date ${todayLADate}`;
    case "note":
      return `python3.11 scripts/track.py set ${num} --note "${sanitize(value)}" --date ${todayLADate}`;
    case "contact":
      return `python3.11 scripts/track.py contact ${num} --contact "${sanitize(value)}"`;
    case "followup_done":
      return `python3.11 scripts/track.py followup ${num} --note "${sanitize(value)}"`;
  }
}

/** Today's date as YYYY-MM-DD in America/Los_Angeles timezone. */
export function todayLA(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Los_Angeles",
  });
}
