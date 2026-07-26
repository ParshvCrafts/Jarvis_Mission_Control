import { pgTable, serial, text } from "drizzle-orm/pg-core";

// Season deadlines — manual entries + optional CSV import
// Pre-seeded EMPTY — user fills it in
export const seasonDeadlinesTable = pgTable("season_deadlines", {
  id: serial("id").primaryKey(),
  company: text("company").notNull().default(""),
  program: text("program").notNull().default(""),
  opensDate: text("opens_date"), // YYYY-MM-DD or null
  closesDate: text("closes_date"), // YYYY-MM-DD or null
  url: text("url").notNull().default(""),
  notes: text("notes").notNull().default(""),
  source: text("source").notNull().default("manual"), // manual | import
});

export type SeasonDeadline = typeof seasonDeadlinesTable.$inferSelect;
export type InsertSeasonDeadline = typeof seasonDeadlinesTable.$inferInsert;
