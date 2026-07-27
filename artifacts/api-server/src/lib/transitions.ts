/**
 * Pipeline transition rules for the Jarvis application tracker.
 *
 * Pipeline order (forward direction):
 *   evaluated → applied → oa → responded → interview → offer → hired
 *
 * Allowed transitions:
 *   1. Forward along the pipeline (any hop, not just adjacent)
 *   2. Any non-terminal → rejected | discarded | withdrawn
 *
 * Forbidden transitions:
 *   - Backward along the pipeline
 *   - Terminal (hired/rejected/discarded/withdrawn) → anything
 *   - Same status → same status
 *   - App emits --force flag: NEVER. Backward corrections happen on the Mac.
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

/** Statuses that cannot transition to anything else */
export const TERMINAL_STATUSES = new Set<string>([
  "hired",
  "rejected",
  "discarded",
  "withdrawn",
]);

/** Exit statuses — non-terminal → these is always allowed */
export const EXIT_STATUSES = new Set<string>([
  "rejected",
  "discarded",
  "withdrawn",
]);

/**
 * Returns true if transitioning from `from` to `to` is allowed without --force.
 */
export function isAllowedTransition(from: string, to: string): boolean {
  if (from === to) return false;

  // Terminal statuses cannot transition to anything
  if (TERMINAL_STATUSES.has(from)) return false;

  // Any non-terminal can exit to rejected/discarded/withdrawn (but not hired via exit)
  if (EXIT_STATUSES.has(to)) return true;

  // Remaining: both must be in the pipeline and to must be further right
  const fromIdx = PIPELINE_ORDER.indexOf(from as PipelineStatus);
  const toIdx = PIPELINE_ORDER.indexOf(to as PipelineStatus);

  if (fromIdx === -1 || toIdx === -1) return false;
  return toIdx > fromIdx;
}

/** All board columns shown in pipeline order (excludes exit statuses which collapse separately) */
export const BOARD_PIPELINE_COLUMNS = PIPELINE_ORDER.filter(
  (s) => !EXIT_STATUSES.has(s),
);

/** All valid status values (pipeline + exit) */
export const ALL_STATUSES = [
  ...PIPELINE_ORDER,
  "rejected",
  "discarded",
  "withdrawn",
] as const;
