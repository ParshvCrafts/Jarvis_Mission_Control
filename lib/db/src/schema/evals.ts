import {
  pgTable,
  integer,
  text,
  boolean,
  serial,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Eval summaries — upsert by num
export const evalSummariesTable = pgTable("eval_summaries", {
  num: integer("num").primaryKey(),
  url: text("url").notNull().default(""),
  company: text("company").notNull().default(""),
  role: text("role").notNull().default(""),
  score: text("score").notNull().default(""),
  recommendation: text("recommendation").notNull().default(""),
  legitimacy: text("legitimacy").notNull().default(""),
  // Stored as JSON text arrays
  blockers: text("blockers").array().notNull().default([]),
  warnings: text("warnings").array().notNull().default([]),
});

export type EvalSummary = typeof evalSummariesTable.$inferSelect;
export type InsertEvalSummary = typeof evalSummariesTable.$inferInsert;

// Cover letters — upsert by (num, file)
export const coverLettersTable = pgTable(
  "cover_letters",
  {
    id: serial("id").primaryKey(),
    num: integer("num").notNull(),
    file: text("file").notNull(),
    date: text("date").notNull().default(""),
    tone: text("tone").notNull().default(""),
    gateClear: boolean("gate_clear").notNull().default(false),
  },
  (table) => [
    uniqueIndex("cover_letters_num_file_idx").on(table.num, table.file),
  ],
);

export type CoverLetter = typeof coverLettersTable.$inferSelect;
export type InsertCoverLetter = typeof coverLettersTable.$inferInsert;
