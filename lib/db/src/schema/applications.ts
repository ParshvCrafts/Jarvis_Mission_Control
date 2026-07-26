import {
  pgTable,
  serial,
  integer,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const applicationsTable = pgTable("applications", {
  // Pipeline's row id — NEVER renumber
  num: integer("num").primaryKey(),
  date: text("date").notNull().default(""),
  company: text("company").notNull().default(""),
  role: text("role").notNull().default(""),
  score: text("score").notNull().default(""),
  status: text("status").notNull().default(""),
  contact: text("contact").notNull().default(""),
  via: text("via").notNull().default(""),
  resume: text("resume").notNull().default(""),
  letter: text("letter").notNull().default(""),
  report: text("report").notNull().default(""),
  notes: text("notes").notNull().default(""),
});

export type Application = typeof applicationsTable.$inferSelect;
export type InsertApplication = typeof applicationsTable.$inferInsert;

// Append-only, deduped on all fields
export const statusEventsTable = pgTable(
  "status_events",
  {
    id: serial("id").primaryKey(),
    num: integer("num").notNull(),
    date: text("date").notNull().default(""),
    fromStatus: text("from_status").notNull().default(""),
    toStatus: text("to_status").notNull().default(""),
    source: text("source").notNull().default(""),
    note: text("note").notNull().default(""),
  },
  (table) => [
    uniqueIndex("status_events_dedup_idx").on(
      table.num,
      table.date,
      table.fromStatus,
      table.toStatus,
      table.source,
      table.note,
    ),
  ],
);

export type StatusEvent = typeof statusEventsTable.$inferSelect;
export type InsertStatusEvent = typeof statusEventsTable.$inferInsert;
