import { desc, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  ingestSnapshotsTable,
  applicationsTable,
  statusEventsTable,
  queueItemsTable,
  evalSummariesTable,
  coverLettersTable,
  followupItemsTable,
  replySuggestionsTable,
} from "@workspace/db/schema";
import type { z } from "zod/v4";
import { isValidTrackCommand, type IngestPayloadSchema } from "./ingestSchema";

export type IngestPayload = z.infer<typeof IngestPayloadSchema>;

/**
 * Shared DB persistence logic for ingest payloads.
 * Used by both POST /api/ingest (bearer-token path) and
 * POST /api/settings/ingest (session-auth fallback path).
 *
 * Idempotency semantics (§5):
 * - applications, evals: upsert by num
 * - covers: upsert by (num, file)
 * - queue: upsert by url; local `reviewed` flag preserved on update
 * - status_events: append-only, dedup on all fields
 * - followups, reply_suggestions: full replace when key is present
 *
 * Returns per-table counts of processed rows.
 */
export async function processIngestPayload(
  data: IngestPayload,
  rawBody: unknown,
): Promise<Record<string, number>> {
  // Single transaction: a mid-payload failure must roll back EVERYTHING.
  // Before this, followups full-replace was delete-then-insert — an insert
  // error left the table empty with applications half-upserted (review M3).
  return await db.transaction(async (db) => {
  // ── Persist snapshot ───────────────────────────────────────────────────
  await db.insert(ingestSnapshotsTable).values({
    payloadVersion: data.payload_version,
    rawJson: rawBody as Record<string, unknown>,
  });

  // Prune to last 30 snapshots
  const snapshots = await db
    .select({ id: ingestSnapshotsTable.id })
    .from(ingestSnapshotsTable)
    .orderBy(desc(ingestSnapshotsTable.receivedAt));
  if (snapshots.length > 30) {
    const toDelete = snapshots.slice(30).map((s) => s.id);
    await db
      .delete(ingestSnapshotsTable)
      .where(inArray(ingestSnapshotsTable.id, toDelete));
  }

  const counts: Record<string, number> = {};

  // ── Applications — upsert by num ───────────────────────────────────────
  if (data.applications) {
    for (const app of data.applications) {
      await db
        .insert(applicationsTable)
        .values({
          num: app.num,
          date: app.date,
          company: app.company,
          role: app.role,
          score: app.score,
          status: app.status,
          contact: app.contact,
          via: app.via,
          resume: app.resume,
          letter: app.letter,
          report: app.report,
          notes: app.notes,
        })
        .onConflictDoUpdate({
          target: applicationsTable.num,
          set: {
            date: app.date,
            company: app.company,
            role: app.role,
            score: app.score,
            status: app.status,
            contact: app.contact,
            via: app.via,
            resume: app.resume,
            letter: app.letter,
            report: app.report,
            notes: app.notes,
          },
        });
    }
    counts.applications = data.applications.length;
  }

  // ── Status events — append-only, dedup on all fields ───────────────────
  if (data.status_events) {
    for (const event of data.status_events) {
      await db
        .insert(statusEventsTable)
        .values({
          num: event.num,
          date: event.date,
          fromStatus: event.from_status,
          toStatus: event.to_status,
          source: event.source,
          note: event.note,
        })
        .onConflictDoNothing();
    }
    counts.status_events = data.status_events.length;
  }

  // ── Queue — upsert by url, preserve reviewed flag ───────────────────────
  if (data.queue) {
    for (const item of data.queue) {
      await db
        .insert(queueItemsTable)
        .values({
          rank: item.rank,
          score: item.score,
          company: item.company,
          title: item.title,
          posted: item.posted,
          url: item.url,
          reviewed: false, // default for new items
        })
        .onConflictDoUpdate({
          target: queueItemsTable.url,
          set: {
            rank: item.rank,
            score: item.score,
            company: item.company,
            title: item.title,
            posted: item.posted,
            // reviewed is intentionally NOT updated — local flag persists
          },
        });
    }
    counts.queue = data.queue.length;
  }

  // ── Eval summaries — upsert by num ─────────────────────────────────────
  if (data.evals) {
    for (const ev of data.evals) {
      await db
        .insert(evalSummariesTable)
        .values({
          num: ev.num,
          url: ev.url,
          company: ev.company,
          role: ev.role,
          score: ev.score,
          recommendation: ev.recommendation,
          legitimacy: ev.legitimacy,
          blockers: ev.blockers,
          warnings: ev.warnings,
        })
        .onConflictDoUpdate({
          target: evalSummariesTable.num,
          set: {
            url: ev.url,
            company: ev.company,
            role: ev.role,
            score: ev.score,
            recommendation: ev.recommendation,
            legitimacy: ev.legitimacy,
            blockers: ev.blockers,
            warnings: ev.warnings,
          },
        });
    }
    counts.evals = data.evals.length;
  }

  // ── Cover letters — upsert by (num, file) ──────────────────────────────
  if (data.covers) {
    for (const cover of data.covers) {
      await db
        .insert(coverLettersTable)
        .values({
          num: cover.num,
          file: cover.file,
          date: cover.date,
          tone: cover.tone,
          gateClear: cover.gate_clear,
        })
        .onConflictDoUpdate({
          target: [coverLettersTable.num, coverLettersTable.file],
          set: {
            date: cover.date,
            tone: cover.tone,
            gateClear: cover.gate_clear,
          },
        });
    }
    counts.covers = data.covers.length;
  }

  // ── Followups — full replace when key is present ───────────────────────
  if (data.followups !== undefined) {
    await db.delete(followupItemsTable);
    if (data.followups.length > 0) {
      await db.insert(followupItemsTable).values(
        data.followups.map((f) => ({
          num: f.num,
          company: f.company,
          role: f.role,
          urgency: f.urgency,
          nextDate: f.next_date,
          reason: f.reason,
        })),
      );
    }
    counts.followups = data.followups.length;
  }

  // ── Reply suggestions — full replace when key is present ───────────────
  if (data.reply_suggestions !== undefined) {
    await db.delete(replySuggestionsTable);
    if (data.reply_suggestions.length > 0) {
      await db.insert(replySuggestionsTable).values(
        data.reply_suggestions.map((r) => ({
          messageDate: r.message_date,
          subject: r.subject,
          fromAddr: r.from_addr,
          kind: r.kind,
          confidence: r.confidence,
          // A command that isn't a clean track.py invocation is never
          // stored (B2): the row survives as informational with a blocker
          // instead of putting untrusted text behind a copy button.
          suggestedCommand: isValidTrackCommand(r.suggested_command)
            ? r.suggested_command
            : "",
          blocker:
            r.suggested_command && !isValidTrackCommand(r.suggested_command)
              ? "command rejected by server validation"
              : r.blocker,
        })),
      );
    }
    counts.reply_suggestions = data.reply_suggestions.length;
  }

  return counts;
  });
}
