import { pgTable, serial, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

// One row per push — keep last 30 for history/diff
export const ingestSnapshotsTable = pgTable("ingest_snapshots", {
  id: serial("id").primaryKey(),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  payloadVersion: integer("payload_version").notNull(),
  rawJson: jsonb("raw_json").notNull().$type<Record<string, unknown>>(),
});

export type IngestSnapshot = typeof ingestSnapshotsTable.$inferSelect;
export type InsertIngestSnapshot = typeof ingestSnapshotsTable.$inferInsert;
