import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db/schema";
import { IngestPayloadSchema } from "../lib/ingestSchema";
import { processIngestPayload } from "../lib/ingestCore";
import {
  autoApplyPendingChanges,
  pruneStalePendingChanges,
} from "../lib/pendingChanges";

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
// Same validation, DB logic, and pending-change auto-apply/prune as
// POST /ingest, but uses session auth instead of bearer token.

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

  const counts = await processIngestPayload(data, req.body);

  // Auto-apply matching pending changes and prune stale ones, same as the
  // token-authenticated ingest path.
  await autoApplyPendingChanges(data);
  await pruneStalePendingChanges();

  res.json({ ok: true, payload_version: data.payload_version, counts });
});

export { WEEKLY_TARGET_KEY, DEFAULT_WEEKLY_TARGET };
export default router;
