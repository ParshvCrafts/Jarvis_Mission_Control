/**
 * Pure auto-apply matching logic for pending changes.
 *
 * Extracted as a pure function so it can be unit-tested without a DB.
 * The ingest route calls `matchesPendingChange` for each active pending change
 * and marks matched changes as 'applied'.
 */

export interface ApplyCheckApp {
  status: string;
  contact: string;
  notes: string;
}

export interface ApplyCheckEvent {
  source: string;
  date: string; // YYYY-MM-DD
}

export interface ApplyCheckChange {
  kind: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

/**
 * Returns true if the given ingest data satisfies the pending change's condition.
 *
 * Matching rules (per kind):
 *   status       — ingested app.status === payload.target_status
 *   contact      — ingested app.contact === payload.target_contact
 *   note         — ingested app.notes CONTAINS payload.note (substring)
 *   followup_done — any StatusEvent with source=followup, dated >= change createdAt date (YYYY-MM-DD)
 */
export function matchesPendingChange(
  change: ApplyCheckChange,
  app: ApplyCheckApp | null,
  statusEvents: ApplyCheckEvent[],
): boolean {
  switch (change.kind) {
    case "status":
      return (
        app !== null &&
        typeof change.payload["target_status"] === "string" &&
        app.status === change.payload["target_status"]
      );

    case "contact":
      return (
        app !== null &&
        typeof change.payload["target_contact"] === "string" &&
        app.contact === change.payload["target_contact"]
      );

    case "note":
      return (
        app !== null &&
        typeof change.payload["note"] === "string" &&
        change.payload["note"].length > 0 &&
        app.notes.includes(change.payload["note"] as string)
      );

    case "followup_done": {
      // YYYY-MM-DD of when the pending change was created (LA timezone)
      const createdDate = change.createdAt
        .toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
      return statusEvents.some(
        (e) => e.source === "followup" && e.date >= createdDate,
      );
    }

    default:
      return false;
  }
}
