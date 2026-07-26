import {
  pgTable,
  serial,
  integer,
  text,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";

// Write-back queue — changes created in the app, never auto-applied upstream
export const pendingChangesTable = pgTable("pending_changes", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  num: integer("num").notNull(),
  kind: text("kind").notNull(), // status | note | followup_done | contact
  payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
  // Exact CLI command to run on the Mac
  command: text("command").notNull(),
  // pending | copied | applied | dismissed
  state: text("state").notNull().default("pending"),
});

export type PendingChange = typeof pendingChangesTable.$inferSelect;
export type InsertPendingChange = typeof pendingChangesTable.$inferInsert;
