#!/usr/bin/env tsx
/**
 * Performance seed script
 *
 * Injects 500 queue items + 100 applications via POST /api/ingest.
 * Used to verify that all dashboard views load <1s under realistic data volumes.
 *
 * Usage:
 *   INGEST_TOKEN=<token> API_URL=http://localhost:8080 tsx scripts/perf-seed.ts
 *
 * Defaults to localhost:8080 if API_URL is not set.
 */

const TOKEN = process.env["INGEST_TOKEN"];
if (!TOKEN) {
  console.error("❌  INGEST_TOKEN env var required");
  process.exit(1);
}

const API_URL = (process.env["API_URL"] ?? "http://localhost:8080").replace(
  /\/$/,
  "",
);

const STATUSES = [
  "evaluated",
  "applied",
  "oa",
  "responded",
  "interview",
  "offer",
  "rejected",
  "discarded",
] as const;

function pickStatus() {
  return STATUSES[Math.floor(Math.random() * STATUSES.length)];
}

function isoDate(daysAgo: number) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split("T")[0]!;
}

// ── Build 100 applications ─────────────────────────────────────────────────────
const applications = Array.from({ length: 100 }, (_, i) => ({
  num: i + 1,
  date: isoDate(Math.floor(Math.random() * 180)),
  company: `Company ${i + 1}`,
  role: `Role ${(i % 10) + 1}`,
  status: pickStatus(),
  score: String(Math.floor(Math.random() * 10) + 1), // score is a string in the schema
  notes: `Auto-seeded application ${i + 1} for performance testing.`,
}));

// ── Build 500 queue items ──────────────────────────────────────────────────────
const QUEUE_TYPES = [
  "status_update",
  "followup_due",
  "reply_needed",
  "application_gap",
] as const;

const queue_items = Array.from({ length: 500 }, (_, i) => ({
  id: `perf-q-${i + 1}`,
  type: QUEUE_TYPES[i % QUEUE_TYPES.length],
  priority: Math.floor(Math.random() * 5) + 1,
  company: `Company ${(i % 100) + 1}`,
  role: `Role ${(i % 10) + 1}`,
  message: `Queue item ${i + 1}: action needed for performance test.`,
  url: `https://example.com/perf-q-${i + 1}`, // url is required
  generated_at: new Date(Date.now() - i * 60_000).toISOString(),
}));

const payload = {
  payload_version: 1,
  generated_at: new Date().toISOString(),
  applications,
  queue: queue_items, // ingest schema key is "queue" not "queue_items"
};

console.log(
  `📦  Seeding ${applications.length} applications + ${queue_items.length} queue items → ${API_URL}/api/ingest`,
);

const t0 = Date.now();
const resp = await fetch(`${API_URL}/api/ingest`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${TOKEN}`,
  },
  body: JSON.stringify(payload),
});

const elapsed = Date.now() - t0;
const body = await resp.json();

if (!resp.ok) {
  console.error(`❌  Ingest failed (${resp.status}):`, JSON.stringify(body));
  process.exit(1);
}

console.log(`✅  Ingest completed in ${elapsed}ms`);
console.log("   Applications upserted:", body.counts?.applications ?? "?");
console.log("   Queue items upserted: ", body.counts?.queue_items ?? "?");
console.log();
console.log("Next steps:");
console.log("  1. Open /today — verify all 4 cards render fast (<1s)");
console.log("  2. Open /applications (table view) — confirm pagination works");
console.log("  3. Open /applications (board view) — confirm columns load fast");
console.log("  4. Open /queue — confirm 500-item list is paginated/scrollable");
console.log("  5. Open /analytics — confirm charts render fast");
