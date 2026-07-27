import { pgTable, text } from "drizzle-orm/pg-core";

// Key-value settings store — one row per setting, persisted across restarts
export const settingsTable = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull().default(""),
});

export type Setting = typeof settingsTable.$inferSelect;
export type InsertSetting = typeof settingsTable.$inferInsert;
