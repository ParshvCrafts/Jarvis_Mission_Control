import { Router } from "express";
import { eq, desc, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db/schema";
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
import { IngestPayloadSchema } from "../lib/ingestSchema";

const router = Router();

const WEEKLY_TARGET_KEY = "weekly_target";
const DEFAULT_WEEKLY_TARGET = 10;

// ── GET /settings ──────────────────────────────────────────────────────────────

router.get("/settings", async (_req, res) => {
  const rows = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, WEEKLY_TARGET_KEY));

  const raw = rows[0]?.value ?? String(DEFAULT_WEEKLY_TARGET);
  const weekly_target = Math.max(1, Math.min(1000, parseInt(raw, 10) || DEFAULT_WEEKLY_TARGET));

  res.json({ weekly_target });
});

// ── PUT /settings ──────────────────────────────────────────────────────────────

router.put("/settings", async (req, res) => {
  const { weekly_target } = req.body ?? {};

  if (
    weekly_target === undefined ||
    typeof weekly_target !== "number" ||
    !Number.isInteger(weekly_target) ||
    weekly_target < 1 ||
    weekly_target > 1000
  ) {
    res.status(422).json({ error: "weekly_target must be an integer between 1 and 1000" });
    return;
  }

  await db
    .insert(settingsTable)
    .values({ key: WEEKLY_TARGET_KEY, value: String(weekly_target) })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value: String(weekly_target) },
    });

  res.json({ weekly_target });
});

// ── POST /settings/ingest — session-authenticated fallback ingest ───────────────
// Same validation and DB logic as POST /ingest, but uses session auth instead
// of bearer token. Auto-apply of pending changes is skipped (fallback path).

router.post("/settings/ingest", async (req, res) => {
  const parsed = IngestPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({
      error: "Validation failed",
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
    return;
  }

  const data = parsed.data;

  if (data.payload_version !== 1) {
    res.status(422).json({
      error: `Unsupported payload_version: ${data.payload_version}. Expected 1.`,
    });
    return;
  }

  // Persist snapshot
  await db.insert(ingestSnapshotsTable).values({
    payloadVersion: data.payload_version,
    rawJson: req.body as Record<string, unknown>,
  });

  // Prune to last 30 snapshots
  const snapshots = await db
    .select({ id: ingestSnapshotsTable.id })
    .from(ingestSnapshotsTable)
    .orderBy(desc(ingestSnapshotsTable.receivedAt));
  if (snapshots.length > 30) {
    const toDelete = snapshots.slice(30).map((s) => s.id);
    await db.delete(ingestSnapshotsTable).where(inArray(ingestSnapshotsTable.id, toDelete));
  }

  const counts: Record<string, number> = {};

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
          reviewed: false,
        })
        .onConflictDoUpdate({
          target: queueItemsTable.url,
          set: {
            rank: item.rank,
            score: item.score,
            company: item.company,
            title: item.title,
            posted: item.posted,
          },
        });
    }
    counts.queue = data.queue.length;
  }

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
          suggestedCommand: r.suggested_command,
          blocker: r.blocker,
        })),
      );
    }
    counts.reply_suggestions = data.reply_suggestions.length;
  }

  res.json({ ok: true, payload_version: data.payload_version, counts });
});

export { WEEKLY_TARGET_KEY, DEFAULT_WEEKLY_TARGET };
export default router;
