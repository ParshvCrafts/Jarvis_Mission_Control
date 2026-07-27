import crypto from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { eq, inArray, and, lt } from "drizzle-orm";
import { db } from "@workspace/db";
import { pendingChangesTable } from "@workspace/db";
import { matchesPendingChange } from "../lib/autoApply";
import { IngestPayloadSchema } from "../lib/ingestSchema";
import { processIngestPayload } from "../lib/ingestCore";

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

    // ── Persist snapshot + upsert all tables (shared logic) ────────────────
    const counts = await processIngestPayload(data, req.body);

    // ── Auto-apply matching pending changes ────────────────────────────────
    // (Full logic implemented in Stage 3; seam exists here)
    await autoApplyPendingChanges(data);

    // ── Prune stale pending changes ────────────────────────────────────────
    // Applied/dismissed rows older than 30 days are no longer useful.
    await pruneStalePendingChanges();

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
 * For each active (pending|copied) change, check if the ingested data satisfies
 * its condition and mark it as 'applied' if so.
 */
async function autoApplyPendingChanges(data: {
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

async function pruneStalePendingChanges(): Promise<void> {
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

export default router;
