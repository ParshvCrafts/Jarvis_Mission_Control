import { eq, inArray, and, lt } from "drizzle-orm";
import { db } from "@workspace/db";
import { pendingChangesTable } from "@workspace/db";
import { matchesPendingChange } from "./autoApply";

/**
 * Auto-apply matching pending changes on ingest.
 * For each active (pending|copied) change, check if the ingested data satisfies
 * its condition and mark it as 'applied' if so.
 *
 * Shared by POST /api/ingest (bearer-token path) and
 * POST /api/settings/ingest (session-auth fallback path).
 */
export async function autoApplyPendingChanges(data: {
  applications?: Array<{ num: number; status: string; contact: string; notes: string }>;
  status_events?: Array<{ num: number; source: string; date: string }>;
}): Promise<void> {
  // Fetch all active pending changes
  const activePending = await db
    .select()
    .from(pendingChangesTable)
    .where(inArray(pendingChangesTable.state, ["pending", "copied"]));

  if (activePending.length === 0) return;

  // Build lookup maps from ingest data
  const appsByNum = new Map(
    (data.applications ?? []).map((a) => [a.num, a]),
  );
  const eventsByNum = new Map<number, Array<{ source: string; date: string }>>();
  for (const e of data.status_events ?? []) {
    if (!eventsByNum.has(e.num)) eventsByNum.set(e.num, []);
    eventsByNum.get(e.num)!.push({ source: e.source, date: e.date });
  }

  for (const change of activePending) {
    const app = appsByNum.get(change.num) ?? null;
    const events = eventsByNum.get(change.num) ?? [];

    const matched = matchesPendingChange(
      {
        kind: change.kind,
        payload: change.payload as Record<string, unknown>,
        createdAt: change.createdAt,
      },
      app,
      events,
    );

    if (matched) {
      await db
        .update(pendingChangesTable)
        .set({ state: "applied" })
        .where(eq(pendingChangesTable.id, change.id));
    }
  }
}

/**
 * Delete applied/dismissed pending changes older than 30 days.
 * Uses the (state, created_at) index; never touches pending/copied rows.
 */
const PENDING_CHANGE_RETENTION_DAYS = 30;

export async function pruneStalePendingChanges(): Promise<void> {
  const cutoff = new Date(
    Date.now() - PENDING_CHANGE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  await db
    .delete(pendingChangesTable)
    .where(
      and(
        inArray(pendingChangesTable.state, ["applied", "dismissed"]),
        lt(pendingChangesTable.createdAt, cutoff),
      ),
    );
}
