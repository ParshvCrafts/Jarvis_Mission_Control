/**
 * Pipeline transition rules for the Jarvis application tracker.
 * Mirrors artifacts/api-server/src/lib/transitions.ts — keep both in sync.
 */

export const PIPELINE_ORDER = [
  "evaluated",
  "applied",
  "oa",
  "responded",
  "interview",
  "offer",
  "hired",
] as const;

export type PipelineStatus = (typeof PIPELINE_ORDER)[number];

export const TERMINAL_STATUSES = new Set<string>([
  "hired",
  "rejected",
  "discarded",
  "withdrawn",
]);

export const EXIT_STATUSES = new Set<string>([
  "rejected",
  "discarded",
  "withdrawn",
]);

/** Board columns in order (excludes exit-only statuses from main columns) */
export const BOARD_PIPELINE_COLS = [...PIPELINE_ORDER] as string[];

/** Terminal-exit columns rendered separately, collapsed by default */
export const BOARD_EXIT_COLS = ["rejected", "discarded", "withdrawn"] as string[];

/**
 * Returns true if transitioning from → to is allowed without --force.
 */
export function isAllowedTransition(from: string, to: string): boolean {
  if (from === to) return false;
  if (TERMINAL_STATUSES.has(from)) return false;
  if (EXIT_STATUSES.has(to)) return true;
  const fromIdx = PIPELINE_ORDER.indexOf(from as PipelineStatus);
  const toIdx = PIPELINE_ORDER.indexOf(to as PipelineStatus);
  if (fromIdx === -1 || toIdx === -1) return false;
  return toIdx > fromIdx;
}
