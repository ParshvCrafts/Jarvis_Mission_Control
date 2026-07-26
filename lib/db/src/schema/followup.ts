import { pgTable, serial, integer, text } from "drizzle-orm/pg-core";

// Computed snapshot — full replace whenever key is present in payload (even as [])
export const followupItemsTable = pgTable("followup_items", {
  id: serial("id").primaryKey(),
  num: integer("num").notNull(),
  company: text("company").notNull().default(""),
  role: text("role").notNull().default(""),
  urgency: text("urgency").notNull().default(""),
  nextDate: text("next_date").notNull().default(""),
  reason: text("reason").notNull().default(""),
});

export type FollowupItem = typeof followupItemsTable.$inferSelect;
export type InsertFollowupItem = typeof followupItemsTable.$inferInsert;

// Computed snapshot — full replace whenever key is present in payload (even as [])
export const replySuggestionsTable = pgTable("reply_suggestions", {
  id: serial("id").primaryKey(),
  messageDate: text("message_date").notNull().default(""),
  subject: text("subject").notNull().default(""),
  fromAddr: text("from_addr").notNull().default(""),
  kind: text("kind").notNull().default(""),
  confidence: text("confidence").notNull().default(""),
  suggestedCommand: text("suggested_command").notNull().default(""),
  blocker: text("blocker").notNull().default(""),
});

export type ReplySuggestion = typeof replySuggestionsTable.$inferSelect;
export type InsertReplySuggestion = typeof replySuggestionsTable.$inferInsert;
