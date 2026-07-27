import { z } from "zod/v4";

// §5 data contract — field names must match exactly

const APPLICATION_STATUSES = [
  "evaluated",
  "applied",
  "oa",
  "responded",
  "interview",
  "offer",
  "hired",
  "rejected",
  "discarded",
  "withdrawn",
] as const;

export const ApplicationItemSchema = z.object({
  num: z.number().int().positive(),
  date: z.string().default(""),
  company: z.string().default(""),
  role: z.string().default(""),
  score: z.string().default(""),
  status: z.enum(APPLICATION_STATUSES),
  contact: z.string().default(""),
  via: z.string().default(""),
  resume: z.string().default(""),
  letter: z.string().default(""),
  report: z.string().default(""),
  notes: z.string().default(""),
});

export const StatusEventItemSchema = z.object({
  num: z.number().int().positive(),
  date: z.string().default(""),
  from_status: z.string().default(""),
  to_status: z.string().default(""),
  source: z.string().default(""),
  note: z.string().default(""),
});

export const QueueItemPayloadSchema = z.object({
  rank: z.number().int().default(0),
  // Absent score means "no score data" — stored as NULL, never coerced to 0
  score: z.number().nullable().default(null),
  company: z.string().default(""),
  title: z.string().default(""),
  posted: z.string().default(""),
  url: z.string().min(1),
});

export const EvalItemSchema = z.object({
  num: z.number().int().positive(),
  url: z.string().default(""),
  company: z.string().default(""),
  role: z.string().default(""),
  score: z.string().default(""),
  recommendation: z.string().default(""),
  legitimacy: z.string().default(""),
  blockers: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});

export const CoverItemSchema = z.object({
  num: z.number().int().positive(),
  file: z.string().min(1),
  date: z.string().default(""),
  tone: z.string().default(""),
  gate_clear: z.boolean().default(false),
});

export const FollowupItemPayloadSchema = z.object({
  num: z.number().int().positive(),
  company: z.string().default(""),
  role: z.string().default(""),
  urgency: z.string().default(""),
  next_date: z.string().default(""),
  reason: z.string().default(""),
});

export const ReplySuggestionPayloadSchema = z.object({
  message_date: z.string().default(""),
  subject: z.string().default(""),
  from_addr: z.string().default(""),
  kind: z.string().default(""),
  confidence: z.string().default(""),
  suggested_command: z.string().default(""),
  blocker: z.string().default(""),
});

/**
 * Full §5 payload schema. All top-level array keys are optional (partial
 * snapshots are allowed). followups and reply_suggestions trigger a full
 * replace of their table whenever the key is present (even as []).
 */
export const IngestPayloadSchema = z.object({
  payload_version: z.number().int(),
  generated_at: z.string().optional(),
  applications: z.array(ApplicationItemSchema).optional(),
  status_events: z.array(StatusEventItemSchema).optional(),
  queue: z.array(QueueItemPayloadSchema).optional(),
  evals: z.array(EvalItemSchema).optional(),
  covers: z.array(CoverItemSchema).optional(),
  // Full-replace when key is present (even as [])
  followups: z.array(FollowupItemPayloadSchema).optional(),
  reply_suggestions: z.array(ReplySuggestionPayloadSchema).optional(),
});

export type IngestPayload = z.infer<typeof IngestPayloadSchema>;

/**
 * Format a pending-change CLI command.
 * Strips newlines, escapes " and $ inside note values.
 */
export function formatPendingCommand(
  kind: "status" | "note" | "contact" | "followup_done",
  num: number,
  value: string,
  todayLA: string,
): string {
  const sanitize = (s: string) =>
    s.replace(/\n/g, " ").replace(/"/g, '\\"').replace(/\$/g, "\\$");

  switch (kind) {
    case "status":
      return `python3.11 scripts/track.py set ${num} ${value} --date ${todayLA}`;
    case "note":
      return `python3.11 scripts/track.py set ${num} --note "${sanitize(value)}" --date ${todayLA}`;
    case "contact":
      return `python3.11 scripts/track.py contact ${num} --contact "${sanitize(value)}"`;
    case "followup_done":
      return `python3.11 scripts/track.py followup ${num} --note "${sanitize(value)}"`;
  }
}
