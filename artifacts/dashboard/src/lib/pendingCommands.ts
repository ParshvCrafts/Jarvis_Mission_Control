/**
 * Command string formatting for pending changes.
 * Mirrors the logic in artifacts/api-server/src/lib/ingestSchema.ts.
 * Both must stay in sync — change one, change both.
 */

/** Sanitize a value for use inside a quoted CLI argument. */
function sanitize(s: string): string {
  return s.replace(/\n/g, " ").replace(/"/g, '\\"').replace(/\$/g, "\\$");
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
