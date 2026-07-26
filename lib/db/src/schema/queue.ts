import { pgTable, serial, integer, text, boolean, real } from "drizzle-orm/pg-core";

// Discovery queue items — upsert by url, always preserve local `reviewed` flag
export const queueItemsTable = pgTable("queue_items", {
  id: serial("id").primaryKey(),
  rank: integer("rank").notNull().default(0),
  score: real("score").notNull().default(0),
  company: text("company").notNull().default(""),
  title: text("title").notNull().default(""),
  posted: text("posted").notNull().default(""), // YYYY-MM-DD
  url: text("url").notNull().unique(),
  // LOCAL to the app — survives re-ingest
  reviewed: boolean("reviewed").notNull().default(false),
});

export type QueueItem = typeof queueItemsTable.$inferSelect;
export type InsertQueueItem = typeof queueItemsTable.$inferInsert;
