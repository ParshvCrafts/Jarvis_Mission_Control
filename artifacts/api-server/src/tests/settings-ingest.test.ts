import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import app from "../app";
import { db } from "@workspace/db";
import {
  ingestSnapshotsTable,
  applicationsTable,
  statusEventsTable,
  pendingChangesTable,
} from "@workspace/db";

// ─── Test environment setup ───────────────────────────────────────────────────
// The Settings-page fallback ingest (POST /api/settings/ingest) uses session
// auth, not the bearer token. These tests verify it auto-applies matching
// pending changes and prunes stale ones — same behavior as POST /api/ingest.

beforeAll(async () => {
  process.env["DEV_SKIP_AUTH"] = "true";
  await db.delete(pendingChangesTable);
  await db.delete(statusEventsTable);
  await db.delete(applicationsTable);
  await db.delete(ingestSnapshotsTable);
});

afterAll(async () => {
  await db.delete(pendingChangesTable);
  await db.delete(statusEventsTable);
  await db.delete(applicationsTable);
  await db.delete(ingestSnapshotsTable);
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const APP_NUM_1 = {
  num: 1,
  date: "2026-01-15",
  company: "Acme Corp",
  role: "SWE II",
  score: "A",
  status: "applied",
  contact: "",
  via: "LinkedIn",
  resume: "resume_v3",
  letter: "cover_acme",
  report: "",
  notes: "",
};

async function createPendingChange(body: {
  num: number;
  kind: string;
  payload: Record<string, unknown>;
}) {
  const res = await request(app)
    .post("/api/pending-changes")
    .send({ ...body, command: "python3.11 scripts/track.py noop" });
  expect(res.status).toBe(201);
  return res.body.change as { id: number; state: string };
}

async function getChangeState(id: number): Promise<string> {
  const [row] = await db
    .select()
    .from(pendingChangesTable)
    .where(eq(pendingChangesTable.id, id));
  return row!.state;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/settings/ingest — auto-apply pending changes", () => {
  it("marks a matching pending change as applied", async () => {
    const change = await createPendingChange({
      num: 1,
      kind: "status",
      payload: { target_status: "interview" },
    });

    // Snapshot where num=1 has NOT advanced yet → stays pending
    let res = await request(app)
      .post("/api/settings/ingest")
      .send({
        payload_version: 1,
        applications: [{ ...APP_NUM_1, status: "applied" }],
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(await getChangeState(change.id)).toBe("pending");

    // Snapshot where the status has advanced → applied
    res = await request(app)
      .post("/api/settings/ingest")
      .send({
        payload_version: 1,
        applications: [{ ...APP_NUM_1, status: "interview" }],
      });
    expect(res.status).toBe(200);
    expect(await getChangeState(change.id)).toBe("applied");
  });
});

describe("POST /api/settings/ingest — prune stale pending changes", () => {
  const DAY = 24 * 60 * 60 * 1000;

  async function seedChange(state: string, ageDays: number): Promise<number> {
    const [row] = await db
      .insert(pendingChangesTable)
      .values({
        num: 999,
        kind: "note",
        payload: { text: "seed" },
        command: "python3.11 scripts/track.py noop",
        state,
        createdAt: new Date(Date.now() - ageDays * DAY),
      })
      .returning();
    return row!.id;
  }

  it("deletes only applied/dismissed rows older than 30 days", async () => {
    // Stale (older than 30 days) — should be pruned
    const staleApplied = await seedChange("applied", 31);
    const staleDismissed = await seedChange("dismissed", 45);

    // Recent applied/dismissed — must remain
    const recentApplied = await seedChange("applied", 29);
    const recentDismissed = await seedChange("dismissed", 1);

    // Active rows of any age — must never be touched
    const oldPending = await seedChange("pending", 90);
    const oldCopied = await seedChange("copied", 90);

    const res = await request(app)
      .post("/api/settings/ingest")
      .send({ payload_version: 1 });
    expect(res.status).toBe(200);

    const rows = await db.select().from(pendingChangesTable);
    const ids = new Set(rows.map((r) => r.id));

    // Stale completed rows gone
    expect(ids.has(staleApplied)).toBe(false);
    expect(ids.has(staleDismissed)).toBe(false);

    // Recent completed rows remain
    expect(ids.has(recentApplied)).toBe(true);
    expect(ids.has(recentDismissed)).toBe(true);

    // Active rows remain regardless of age
    expect(ids.has(oldPending)).toBe(true);
    expect(ids.has(oldCopied)).toBe(true);
  });
});
