import { pool } from "@workspace/db";
import { logger } from "./logger";

/**
 * Additive migration-on-boot.
 * All statements are CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS —
 * never destructive. Safe to run on every server start.
 */
export async function runMigrations(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set for migrations");
  }

  const client = await pool.connect();

  try {
    logger.info("Running database migrations...");

    // Auth tables (Replit Auth)
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid VARCHAR PRIMARY KEY,
        sess JSONB NOT NULL,
        expire TIMESTAMP NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON sessions (expire);

      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR UNIQUE,
        first_name VARCHAR,
        last_name VARCHAR,
        profile_image_url VARCHAR,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Ingest snapshots — one per push, keep last 30
    await client.query(`
      CREATE TABLE IF NOT EXISTS ingest_snapshots (
        id SERIAL PRIMARY KEY,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        payload_version INTEGER NOT NULL,
        raw_json JSONB NOT NULL
      );
    `);

    // Applications — upsert by num (pipeline row id, NEVER renumber)
    await client.query(`
      CREATE TABLE IF NOT EXISTS applications (
        num INTEGER PRIMARY KEY,
        date TEXT NOT NULL DEFAULT '',
        company TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT '',
        score TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT '',
        contact TEXT NOT NULL DEFAULT '',
        via TEXT NOT NULL DEFAULT '',
        resume TEXT NOT NULL DEFAULT '',
        letter TEXT NOT NULL DEFAULT '',
        report TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT ''
      );
    `);

    // Status events — append-only, dedup on all fields
    await client.query(`
      CREATE TABLE IF NOT EXISTS status_events (
        id SERIAL PRIMARY KEY,
        num INTEGER NOT NULL,
        date TEXT NOT NULL DEFAULT '',
        from_status TEXT NOT NULL DEFAULT '',
        to_status TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT ''
      );
      CREATE UNIQUE INDEX IF NOT EXISTS status_events_dedup_idx
        ON status_events (num, date, from_status, to_status, source, note);
    `);

    // Queue items — upsert by url, preserve local reviewed flag
    await client.query(`
      CREATE TABLE IF NOT EXISTS queue_items (
        id SERIAL PRIMARY KEY,
        rank INTEGER NOT NULL DEFAULT 0,
        score REAL NOT NULL DEFAULT 0,
        company TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        posted TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL UNIQUE,
        reviewed BOOLEAN NOT NULL DEFAULT FALSE
      );
    `);

    // Eval summaries — upsert by num
    await client.query(`
      CREATE TABLE IF NOT EXISTS eval_summaries (
        num INTEGER PRIMARY KEY,
        url TEXT NOT NULL DEFAULT '',
        company TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT '',
        score TEXT NOT NULL DEFAULT '',
        recommendation TEXT NOT NULL DEFAULT '',
        legitimacy TEXT NOT NULL DEFAULT '',
        blockers TEXT[] NOT NULL DEFAULT '{}',
        warnings TEXT[] NOT NULL DEFAULT '{}'
      );
    `);

    // Cover letters — upsert by (num, file)
    await client.query(`
      CREATE TABLE IF NOT EXISTS cover_letters (
        id SERIAL PRIMARY KEY,
        num INTEGER NOT NULL,
        file TEXT NOT NULL,
        date TEXT NOT NULL DEFAULT '',
        tone TEXT NOT NULL DEFAULT '',
        gate_clear BOOLEAN NOT NULL DEFAULT FALSE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS cover_letters_num_file_idx
        ON cover_letters (num, file);
    `);

    // Followup items — full replace whenever key present in payload
    await client.query(`
      CREATE TABLE IF NOT EXISTS followup_items (
        id SERIAL PRIMARY KEY,
        num INTEGER NOT NULL,
        company TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT '',
        urgency TEXT NOT NULL DEFAULT '',
        next_date TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL DEFAULT ''
      );
    `);

    // Reply suggestions — full replace whenever key present in payload
    await client.query(`
      CREATE TABLE IF NOT EXISTS reply_suggestions (
        id SERIAL PRIMARY KEY,
        message_date TEXT NOT NULL DEFAULT '',
        subject TEXT NOT NULL DEFAULT '',
        from_addr TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT '',
        confidence TEXT NOT NULL DEFAULT '',
        suggested_command TEXT NOT NULL DEFAULT '',
        blocker TEXT NOT NULL DEFAULT ''
      );
    `);

    // Pending changes — write-back queue (created in app, applied on Mac)
    await client.query(`
      CREATE TABLE IF NOT EXISTS pending_changes (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        num INTEGER NOT NULL,
        kind TEXT NOT NULL,
        payload JSONB NOT NULL,
        command TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending'
      );
    `);

    // Season deadlines — manual entries + CSV import, pre-seeded empty
    await client.query(`
      CREATE TABLE IF NOT EXISTS season_deadlines (
        id SERIAL PRIMARY KEY,
        company TEXT NOT NULL DEFAULT '',
        program TEXT NOT NULL DEFAULT '',
        opens_date TEXT,
        closes_date TEXT,
        url TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'manual'
      );
    `);

    // App settings — key-value store (weekly_target, etc.)
    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT ''
      );
    `);

    logger.info("Database migrations complete");
  } finally {
    client.release();
  }
}
