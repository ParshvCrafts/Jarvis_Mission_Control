import crypto from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { eq, desc, inArray } from "drizzle-orm";
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
} from "@workspace/db";
import { IngestPayloadSchema } from "../lib/ingestSchema";

const router: IRouter = Router();

// Rate limiter: 10 requests per minute (disabled in test to avoid cross-test interference)
const ingestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env["NODE_ENV"] === "test" ? 10_000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: "Rate limit exceeded. Max 10 ingests/min." });
  },
});

function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  // Pad shorter to same length to avoid early-exit leaks, then compare
  const len = Math.max(aBuf.length, bBuf.length);
  const aPadded = Buffer.alloc(len);
  const bPadded = Buffer.alloc(len);
  aBuf.copy(aPadded);
  bBuf.copy(bPadded);
  return crypto.timingSafeEqual(aPadded, bPadded);
}

/**
 * POST /api/ingest
 *
 * Auth: Bearer token from INGEST_TOKEN env secret (constant-time comparison).
 * Body: JSON ≤ 5 MB, validated against §5 schema.
 * Idempotency: upsert/replace per §5 table semantics.
 */
router.post(
  "/ingest",
  ingestLimiter,
  async (req: Request, res: Response): Promise<void> => {
    // ── Token auth ─────────────────────────────────────────────────────────
    const ingestToken = process.env.INGEST_TOKEN ?? "";
    const authHeader = req.headers["authorization"] ?? "";
    const provided = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : "";

    if (!ingestToken || !constantTimeEqual(provided, ingestToken)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // ── Validate payload ───────────────────────────────────────────────────
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

    // Reject unknown major payload versions
    if (data.payload_version !== 1) {
      res.status(422).json({
        error: `Unsupported payload_version: ${data.payload_version}. Expected 1.`,
      });
      return;
    }

    // ── Persist snapshot ───────────────────────────────────────────────────
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
            suggestedCommand: r.suggested_command,
            blocker: r.blocker,
          })),
        );
      }
      counts.reply_suggestions = data.reply_suggestions.length;
    }

    // ── Auto-apply matching pending changes ────────────────────────────────
    // (Full logic implemented in Stage 3; seam exists here)
    await autoApplyPendingChanges(data);

    req.log.info({ counts }, "Ingest complete");
    res.json({
      ok: true,
      payload_version: data.payload_version,
      counts,
    });
  },
);

/**
 * Auto-apply matching pending changes on ingest.
 * Full logic is in Stage 3; this stub keeps the seam for now.
 */
async function autoApplyPendingChanges(_data: unknown): Promise<void> {
  // Stage 3 will implement: status/contact/note/followup_done matching
}

export default router;
