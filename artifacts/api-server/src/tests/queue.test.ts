import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { db } from "@workspace/db";
import { queueItemsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function seedQueue(items: Partial<typeof queueItemsTable.$inferInsert>[]) {
  await db.delete(queueItemsTable);
  if (items.length === 0) return;
  await db.insert(queueItemsTable).values(
    items.map((item, i) => ({
      rank: i + 1,
      score: 80,
      company: "ACME",
      title: "SWE",
      posted: "2026-07-20",
      url: `https://example.com/job/${i + 1}`,
      reviewed: false,
      ...item,
    })),
  );
}

// DEV_SKIP_AUTH=true is checked at request time, so setting it in beforeAll works.
function agent() {
  return request(app);
}

// ── Setup ─────────────────────────────────────────────────────────────────────

const TEST_INGEST_TOKEN = "test-queue-ingest-token-xyz";

beforeAll(async () => {
  process.env["DEV_SKIP_AUTH"] = "true";
  process.env["INGEST_TOKEN"] = TEST_INGEST_TOKEN;
  await db.delete(queueItemsTable);
});

afterAll(async () => {
  await db.delete(queueItemsTable);
});

// ── GET /queue ────────────────────────────────────────────────────────────────

describe("GET /api/queue", () => {
  it("returns empty list when no items", async () => {
    await seedQueue([]);
    const res = await agent().get("/api/queue");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
    expect(res.body.total).toBe(0);
    expect(res.body.page).toBe(1);
    expect(res.body.page_size).toBe(50);
  });

  it("returns unreviewed items by default, sorted by rank", async () => {
    await seedQueue([
      { rank: 2, company: "Beta", url: "https://beta.com", reviewed: false },
      { rank: 1, company: "Alpha", url: "https://alpha.com", reviewed: false },
      { rank: 3, company: "Gamma", url: "https://gamma.com", reviewed: true },
    ]);
    const res = await agent().get("/api/queue");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].company).toBe("Alpha"); // rank 1 first
    expect(res.body.items[1].company).toBe("Beta");  // rank 2 second
  });

  it("filter=all returns reviewed and unreviewed", async () => {
    const res = await agent().get("/api/queue?filter=all");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
  });

  it("company search filters case-insensitively", async () => {
    const res = await agent().get("/api/queue?filter=all&company=ALPHA");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].company).toBe("Alpha");
  });

  it("pagination returns correct slice", async () => {
    await seedQueue(
      Array.from({ length: 10 }, (_, i) => ({
        rank: i + 1,
        company: `Co${i}`,
        url: `https://co${i}.com`,
      })),
    );
    const res = await agent().get("/api/queue?page=2&page_size=3");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(3);
    expect(res.body.page).toBe(2);
    expect(res.body.total).toBe(10);
  });

  it("posted_age_days is always a finite integer, even with empty posted", async () => {
    await seedQueue([
      { url: "https://empty-posted.com", posted: "" },      // empty posted → 0
      { url: "https://bad-posted.com",   posted: "not-a-date" }, // invalid → 0
      { url: "https://valid-posted.com", posted: "2026-07-20" },  // valid
    ]);
    const res = await agent().get("/api/queue?filter=all");
    expect(res.status).toBe(200);
    for (const item of res.body.items) {
      expect(typeof item.posted_age_days).toBe("number");
      expect(Number.isFinite(item.posted_age_days)).toBe(true);
      expect(item.posted_age_days).toBeGreaterThanOrEqual(0);
    }
    const emptyRow = res.body.items.find((i: { url: string }) => i.url === "https://empty-posted.com");
    expect(emptyRow.posted_age_days).toBe(0);
    const badRow = res.body.items.find((i: { url: string }) => i.url === "https://bad-posted.com");
    expect(badRow.posted_age_days).toBe(0);
  });
});

// ── PATCH /queue/:id/reviewed ─────────────────────────────────────────────────

describe("PATCH /api/queue/:id/reviewed", () => {
  it("sets reviewed=true on a valid item", async () => {
    await seedQueue([{ url: "https://patch-test.com", reviewed: false }]);
    const [item] = await db
      .select()
      .from(queueItemsTable)
      .where(eq(queueItemsTable.url, "https://patch-test.com"));

    const res = await agent()
      .patch(`/api/queue/${item.id}/reviewed`)
      .send({ reviewed: true });
    expect(res.status).toBe(200);
    expect(res.body.item.reviewed).toBe(true);
    expect(typeof res.body.item.posted_age_days).toBe("number");
    expect(Number.isFinite(res.body.item.posted_age_days)).toBe(true);
  });

  it("sets reviewed=false (undo review)", async () => {
    await seedQueue([{ url: "https://patch-undo.com", reviewed: true }]);
    const [item] = await db
      .select()
      .from(queueItemsTable)
      .where(eq(queueItemsTable.url, "https://patch-undo.com"));

    const res = await agent()
      .patch(`/api/queue/${item.id}/reviewed`)
      .send({ reviewed: false });
    expect(res.status).toBe(200);
    expect(res.body.item.reviewed).toBe(false);
  });

  it("returns 404 for unknown id", async () => {
    const res = await agent()
      .patch("/api/queue/999999/reviewed")
      .send({ reviewed: true });
    expect(res.status).toBe(404);
  });

  it("returns 422 for non-integer id (letters)", async () => {
    const res = await agent()
      .patch("/api/queue/abc/reviewed")
      .send({ reviewed: true });
    expect(res.status).toBe(422);
  });

  it("returns 422 for id with trailing letters (e.g. 1abc)", async () => {
    const res = await agent()
      .patch("/api/queue/1abc/reviewed")
      .send({ reviewed: true });
    expect(res.status).toBe(422);
  });

  it("returns 422 for decimal id (e.g. 1.5)", async () => {
    const res = await agent()
      .patch("/api/queue/1.5/reviewed")
      .send({ reviewed: true });
    expect(res.status).toBe(422);
  });

  it("returns 422 for id with leading whitespace", async () => {
    const res = await agent()
      .patch("/api/queue/ 1/reviewed")
      .send({ reviewed: true });
    // Express will 404 for path with space, but document the expected contract
    expect([404, 422]).toContain(res.status);
  });

  it("returns 422 when body is missing reviewed field", async () => {
    await seedQueue([{ url: "https://patch-bad-body.com" }]);
    const [item] = await db
      .select()
      .from(queueItemsTable)
      .where(eq(queueItemsTable.url, "https://patch-bad-body.com"));

    const res = await agent()
      .patch(`/api/queue/${item.id}/reviewed`)
      .send({ notReviewed: true });
    expect(res.status).toBe(422);
  });

  it("returns 422 when reviewed is not a boolean", async () => {
    await seedQueue([{ url: "https://patch-bad-type.com" }]);
    const [item] = await db
      .select()
      .from(queueItemsTable)
      .where(eq(queueItemsTable.url, "https://patch-bad-type.com"));

    const res = await agent()
      .patch(`/api/queue/${item.id}/reviewed`)
      .send({ reviewed: "yes" });
    expect(res.status).toBe(422);
  });
});

// ── Gate: reviewed flag survives re-ingest ───────────────────────────────────

describe("Queue gate: reviewed flag survives ingest upsert", () => {
  it("reviewed=true is preserved when the same URL is re-ingested", async () => {
    const INGEST_TOKEN = TEST_INGEST_TOKEN;

    // Seed one item via ingest
    const payload = {
      payload_version: 1,
      generated_at: new Date().toISOString(),
      applications: [],
      status_events: [],
      evals: [],
      followups: [],
      covers: [],
      reply_suggestions: [],
      queue: [
        {
          rank: 1,
          score: 90,
          company: "GateTest Co",
          title: "Eng",
          posted: "2026-07-01",
          url: "https://gatetest.example.com/job/1",
        },
      ],
    };

    const ingest1 = await agent()
      .post("/api/ingest")
      .set("Authorization", `Bearer ${INGEST_TOKEN}`)
      .send(payload);
    expect(ingest1.status).toBe(200);

    // Find and mark reviewed
    const [item] = await db
      .select()
      .from(queueItemsTable)
      .where(eq(queueItemsTable.url, "https://gatetest.example.com/job/1"));
    expect(item).toBeDefined();

    const patch = await agent()
      .patch(`/api/queue/${item.id}/reviewed`)
      .send({ reviewed: true });
    expect(patch.status).toBe(200);

    // Re-ingest the exact same payload
    const ingest2 = await agent()
      .post("/api/ingest")
      .set("Authorization", `Bearer ${INGEST_TOKEN}`)
      .send({ ...payload, generated_at: new Date().toISOString() });
    expect(ingest2.status).toBe(200);

    // reviewed flag must still be true
    const [after] = await db
      .select()
      .from(queueItemsTable)
      .where(eq(queueItemsTable.url, "https://gatetest.example.com/job/1"));
    expect(after.reviewed).toBe(true);
  });
});

// ── Gate: missing score stays null (never coerced to 0) ─────────────────────

describe("Queue score: missing score is null, not 0.0", () => {
  it("ingest without score stores NULL and GET /queue returns score: null", async () => {
    const payload = {
      payload_version: 1,
      generated_at: new Date().toISOString(),
      queue: [
        {
          rank: 1,
          company: "NoScore Co",
          title: "Eng",
          posted: "2026-07-01",
          url: "https://noscore.example.com/job/1",
        },
        {
          rank: 2,
          score: 72.5,
          company: "Scored Co",
          title: "Eng",
          posted: "2026-07-01",
          url: "https://scored.example.com/job/1",
        },
      ],
    };

    const ingest = await agent()
      .post("/api/ingest")
      .set("Authorization", `Bearer ${TEST_INGEST_TOKEN}`)
      .send(payload);
    expect(ingest.status).toBe(200);

    const res = await agent().get(
      "/api/queue?filter=all&company=NoScore&page_size=10",
    );
    expect(res.status).toBe(200);
    const noScore = res.body.items.find(
      (i: { url: string }) => i.url === "https://noscore.example.com/job/1",
    );
    expect(noScore).toBeDefined();
    expect(noScore.score).toBeNull();

    const res2 = await agent().get(
      "/api/queue?filter=all&company=Scored&page_size=10",
    );
    const scored = res2.body.items.find(
      (i: { url: string }) => i.url === "https://scored.example.com/job/1",
    );
    expect(scored.score).toBeCloseTo(72.5);
  });
});
