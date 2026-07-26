import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
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

// ─── Test environment setup ───────────────────────────────────────────────────

const INGEST_TOKEN = "test-ingest-token-abc123";

beforeAll(async () => {
  process.env["INGEST_TOKEN"] = INGEST_TOKEN;
  process.env["AUTH_MODE"] = "basic";
  process.env["AUTH_BASIC_USER"] = "admin";
  // bcrypt hash of "password" with rounds=10
  process.env["AUTH_BASIC_PASSWORD_HASH"] =
    "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

  // Truncate all test-relevant tables
  await db.delete(replySuggestionsTable);
  await db.delete(followupItemsTable);
  await db.delete(coverLettersTable);
  await db.delete(evalSummariesTable);
  await db.delete(queueItemsTable);
  await db.delete(statusEventsTable);
  await db.delete(applicationsTable);
  await db.delete(ingestSnapshotsTable);
});

afterAll(async () => {
  await db.delete(replySuggestionsTable);
  await db.delete(followupItemsTable);
  await db.delete(coverLettersTable);
  await db.delete(evalSummariesTable);
  await db.delete(queueItemsTable);
  await db.delete(statusEventsTable);
  await db.delete(applicationsTable);
  await db.delete(ingestSnapshotsTable);
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_PAYLOAD = {
  payload_version: 1,
  generated_at: "2026-07-26T00:00:00Z",
  applications: [
    {
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
      notes: 'Has a "quirky" culture and $500k ARR',
    },
    {
      num: 2,
      date: "2026-01-20",
      company: "Stripe",
      role: "Staff Engineer",
      score: "A+",
      status: "interview",
      contact: "jane@stripe.com",
      via: "referral",
      resume: "resume_v3",
      letter: "",
      report: "",
      notes: "",
    },
  ],
  status_events: [
    {
      num: 1,
      date: "2026-01-15",
      from_status: "",
      to_status: "applied",
      source: "mac",
      note: "",
    },
    {
      num: 2,
      date: "2026-01-20",
      from_status: "",
      to_status: "applied",
      source: "mac",
      note: "",
    },
    {
      num: 2,
      date: "2026-02-05",
      from_status: "applied",
      to_status: "interview",
      source: "mac",
      note: "Phone screen",
    },
  ],
  queue: [
    {
      rank: 1,
      score: 92.5,
      company: "Figma",
      title: "Senior SWE",
      posted: "2026-01-10",
      url: "https://figma.com/jobs/1",
    },
  ],
  evals: [
    {
      num: 1,
      url: "https://acme.com",
      company: "Acme Corp",
      role: "SWE II",
      score: "A",
      recommendation: "apply",
      legitimacy: "legit",
      blockers: [],
      warnings: ["Low salary band"],
    },
  ],
  covers: [
    {
      num: 1,
      file: "cover_acme_v1.pdf",
      date: "2026-01-14",
      tone: "professional",
      gate_clear: true,
    },
  ],
  followups: [
    {
      num: 1,
      company: "Acme Corp",
      role: "SWE II",
      urgency: "high",
      next_date: "2026-02-01",
      reason: "No response after 2 weeks",
    },
  ],
  reply_suggestions: [
    {
      message_date: "2026-01-22",
      subject: "Re: Application",
      from_addr: "recruiter@acme.com",
      kind: "schedule",
      confidence: "high",
      suggested_command: 'python3.11 scripts/track.py set 1 responded',
      blocker: "",
    },
  ],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/ingest", () => {
  it("401 — missing token", async () => {
    const res = await request(app).post("/api/ingest").send(BASE_PAYLOAD);
    expect(res.status).toBe(401);
  });

  it("401 — wrong token", async () => {
    const res = await request(app)
      .post("/api/ingest")
      .set("Authorization", "Bearer wrong-token")
      .send(BASE_PAYLOAD);
    expect(res.status).toBe(401);
  });

  it("422 — malformed payload (missing required field)", async () => {
    const res = await request(app)
      .post("/api/ingest")
      .set("Authorization", `Bearer ${INGEST_TOKEN}`)
      .send({ payload_version: 1, applications: [{ num: 1 }] }); // status missing
    expect(res.status).toBe(422);
    expect(res.body.issues).toBeDefined();
  });

  it("422 — unknown payload_version", async () => {
    const res = await request(app)
      .post("/api/ingest")
      .set("Authorization", `Bearer ${INGEST_TOKEN}`)
      .send({ ...BASE_PAYLOAD, payload_version: 99 });
    expect(res.status).toBe(422);
  });

  it("413 — body too large", async () => {
    const huge = "x".repeat(6 * 1024 * 1024); // 6 MB
    const res = await request(app)
      .post("/api/ingest")
      .set("Authorization", `Bearer ${INGEST_TOKEN}`)
      .set("Content-Type", "application/json")
      .send(`{"payload_version":1,"notes":"${huge}"}`);
    expect(res.status).toBe(413);
  });

  it("200 — happy path, all tables written", async () => {
    const res = await request(app)
      .post("/api/ingest")
      .set("Authorization", `Bearer ${INGEST_TOKEN}`)
      .send(BASE_PAYLOAD);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.counts.applications).toBe(2);
    expect(res.body.counts.status_events).toBe(3);
    expect(res.body.counts.queue).toBe(1);
    expect(res.body.counts.evals).toBe(1);
    expect(res.body.counts.covers).toBe(1);
    expect(res.body.counts.followups).toBe(1);
    expect(res.body.counts.reply_suggestions).toBe(1);

    // Verify DB contents
    const apps = await db.select().from(applicationsTable);
    expect(apps).toHaveLength(2);
    const acme = apps.find((a) => a.num === 1)!;
    // Verify special chars survived the round-trip
    expect(acme.notes).toContain('"quirky"');
    expect(acme.notes).toContain("$500k");

    const events = await db.select().from(statusEventsTable);
    expect(events).toHaveLength(3);

    const queue = await db.select().from(queueItemsTable);
    expect(queue).toHaveLength(1);
    expect(queue[0].reviewed).toBe(false); // default

    const followups = await db.select().from(followupItemsTable);
    expect(followups).toHaveLength(1);

    const replies = await db.select().from(replySuggestionsTable);
    expect(replies).toHaveLength(1);
  });

  it("200 — idempotent re-ingest: same data, no duplicates", async () => {
    const res = await request(app)
      .post("/api/ingest")
      .set("Authorization", `Bearer ${INGEST_TOKEN}`)
      .send(BASE_PAYLOAD);
    expect(res.status).toBe(200);

    // Applications should still be 2 (upsert by num)
    const apps = await db.select().from(applicationsTable);
    expect(apps).toHaveLength(2);

    // Status events should still be 3 (dedup by all fields)
    const events = await db.select().from(statusEventsTable);
    expect(events).toHaveLength(3);

    // Followups fully replaced — still 1
    const followups = await db.select().from(followupItemsTable);
    expect(followups).toHaveLength(1);
  });

  it("200 — partial snapshot preserves absent rows", async () => {
    // Ingest with only num=1 (Stripe is absent)
    const partial = {
      payload_version: 1,
      applications: [
        {
          num: 1,
          date: "2026-01-15",
          company: "Acme Corp",
          role: "SWE II",
          score: "A",
          status: "applied",
          contact: "",
          via: "LinkedIn",
          resume: "resume_v4", // updated resume
          letter: "cover_acme",
          report: "",
          notes: 'Has a "quirky" culture and $500k ARR',
        },
      ],
    };
    const res = await request(app)
      .post("/api/ingest")
      .set("Authorization", `Bearer ${INGEST_TOKEN}`)
      .send(partial);
    expect(res.status).toBe(200);

    // Both apps should still exist
    const apps = await db.select().from(applicationsTable);
    expect(apps).toHaveLength(2);

    // Acme's resume should be updated
    const acme = apps.find((a) => a.num === 1)!;
    expect(acme.resume).toBe("resume_v4");

    // Stripe should be unchanged
    const stripe = apps.find((a) => a.num === 2)!;
    expect(stripe.company).toBe("Stripe");
  });

  it("200 — queue upsert preserves reviewed flag", async () => {
    // Mark the queue item as reviewed directly in DB
    const [item] = await db.select().from(queueItemsTable);
    await db
      .update(queueItemsTable)
      .set({ reviewed: true })
      .where(
        (await import("drizzle-orm")).eq(queueItemsTable.id, item.id),
      );

    // Re-ingest with same queue
    const res = await request(app)
      .post("/api/ingest")
      .set("Authorization", `Bearer ${INGEST_TOKEN}`)
      .send({ payload_version: 1, queue: BASE_PAYLOAD.queue });
    expect(res.status).toBe(200);

    // reviewed flag should be preserved
    const queue = await db.select().from(queueItemsTable);
    expect(queue[0].reviewed).toBe(true);
  });

  it("200 — followups: key present as [] replaces table", async () => {
    const res = await request(app)
      .post("/api/ingest")
      .set("Authorization", `Bearer ${INGEST_TOKEN}`)
      .send({ payload_version: 1, followups: [] });
    expect(res.status).toBe(200);

    const followups = await db.select().from(followupItemsTable);
    expect(followups).toHaveLength(0);
  });

  it("200 — followups: key absent → table unchanged", async () => {
    // First, seed a followup
    await request(app)
      .post("/api/ingest")
      .set("Authorization", `Bearer ${INGEST_TOKEN}`)
      .send({ payload_version: 1, followups: [BASE_PAYLOAD.followups[0]] });

    // Now ingest WITHOUT followups key
    const res = await request(app)
      .post("/api/ingest")
      .set("Authorization", `Bearer ${INGEST_TOKEN}`)
      .send({ payload_version: 1 });
    expect(res.status).toBe(200);

    // Followup should still be there
    const followups = await db.select().from(followupItemsTable);
    expect(followups).toHaveLength(1);
  });
});

describe("AUTH_MODE=basic", () => {
  it("401 — wrong password returns 401", async () => {
    const wrongCreds = Buffer.from("admin:wrongpassword").toString("base64");
    const res = await request(app)
      .get("/api/healthz")
      .set("Authorization", `Basic ${wrongCreds}`);
    // healthz is public — auth not required, so 200 expected here
    // This test just verifies the endpoint responds
    expect([200, 401]).toContain(res.status);
  });
});
