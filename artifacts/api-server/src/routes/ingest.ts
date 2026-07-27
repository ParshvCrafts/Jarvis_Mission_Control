import crypto from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { IngestPayloadSchema } from "../lib/ingestSchema";
import { processIngestPayload } from "../lib/ingestCore";
import {
  autoApplyPendingChanges,
  pruneStalePendingChanges,
} from "../lib/pendingChanges";

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

export default router;
