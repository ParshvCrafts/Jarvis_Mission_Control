/**
 * Pure analytics computation functions — no DB access here.
 * All exported for direct unit testing.
 */

// ── Pipeline definition ───────────────────────────────────────────────────────

export const PIPELINE = [
  "evaluated",
  "applied",
  "oa",
  "responded",
  "interview",
  "offer",
  "hired",
] as const;

export type PipelineStage = (typeof PIPELINE)[number];

export const TERMINAL_STATUSES = new Set(["rejected", "withdrawn", "discarded"]);
export const RESPONSE_STATUSES = new Set(["responded", "interview", "offer", "hired"]);
const TERMINAL_POSITIVE = new Set(["offer", "hired"]);

// ── Input row types ───────────────────────────────────────────────────────────

export type AppRow = { num: number; status: string; resume: string };
export type EventRow = { num: number; toStatus: string; date: string };
export type EvalRow = { num: number; score: string };
export type CoverRow = { num: number; file: string; date: string; tone: string };

// ── Funnel ────────────────────────────────────────────────────────────────────

export type FunnelStage = {
  stage: string;
  count: number;       // apps that entered this stage (via any status event)
  in_flight: number;   // currently at this stage (non-terminal)
  conversion_pct: number | null; // null when denominator = 0
};

/**
 * Right-censored funnel.
 *
 * For each adjacent pair (S → S+1):
 *   denominator = apps that entered S and have LEFT S (reached terminal OR moved forward)
 *               = reached(S) − in_flight(S)
 *   numerator   = apps that entered S+1
 *   conversion  = numerator / denominator  (null if denominator = 0)
 *
 * In-flight apps at S are right-censored because they may still progress.
 */
export function computeFunnel(apps: AppRow[], events: EventRow[]): FunnelStage[] {
  // Which apps reached each stage (via status events)
  const reachedStage = new Map<string, Set<number>>();
  for (const e of events) {
    if (!reachedStage.has(e.toStatus)) reachedStage.set(e.toStatus, new Set());
    reachedStage.get(e.toStatus)!.add(e.num);
  }

  // Which apps are currently at each stage (non-terminal only)
  const currentlyAt = new Map<string, Set<number>>();
  for (const app of apps) {
    if (TERMINAL_STATUSES.has(app.status)) continue;
    if (!currentlyAt.has(app.status)) currentlyAt.set(app.status, new Set());
    currentlyAt.get(app.status)!.add(app.num);
  }

  return PIPELINE.map((stage, i) => {
    const count = reachedStage.get(stage)?.size ?? 0;
    const in_flight = currentlyAt.get(stage)?.size ?? 0;

    let conversion_pct: number | null = null;
    if (i < PIPELINE.length - 1) {
      const nextCount = reachedStage.get(PIPELINE[i + 1])?.size ?? 0;
      const denominator = count - in_flight; // apps that LEFT this stage
      if (denominator > 0) {
        conversion_pct = Math.round((nextCount / denominator) * 100);
      }
    }

    return { stage, count, in_flight, conversion_pct };
  });
}

// ── Score bands ───────────────────────────────────────────────────────────────

export type ScoreBand = "high" | "mid" | "low" | "unscored";

/**
 * Bucket a score string into a band.
 * ≥ 4.0 → high   (4.0 itself belongs here)
 * ≥ 3.0 → mid
 * < 3.0 → low
 * empty / unparseable / "N/A" → unscored  (never silently dropped)
 */
export function bucketScore(score: string): ScoreBand {
  if (!score || score.trim() === "" || score.trim().toUpperCase() === "N/A") return "unscored";
  const n = parseFloat(score.trim());
  if (!isFinite(n)) return "unscored";
  if (n >= 4) return "high";
  if (n >= 3) return "mid";
  return "low";
}

export type ScoreBandRow = {
  band: ScoreBand;
  n: number;
  in_flight_n: number;
  terminal_positive_n: number; // offer / hired
  terminal_negative_n: number; // rejected / withdrawn / discarded
};

export function computeScoreBandsResult(apps: AppRow[], evals: EvalRow[]): ScoreBandRow[] {
  const scoreByNum = new Map(evals.map((e) => [e.num, e.score]));

  const rows: Record<ScoreBand, ScoreBandRow> = {
    high: { band: "high", n: 0, in_flight_n: 0, terminal_positive_n: 0, terminal_negative_n: 0 },
    mid: { band: "mid", n: 0, in_flight_n: 0, terminal_positive_n: 0, terminal_negative_n: 0 },
    low: { band: "low", n: 0, in_flight_n: 0, terminal_positive_n: 0, terminal_negative_n: 0 },
    unscored: { band: "unscored", n: 0, in_flight_n: 0, terminal_positive_n: 0, terminal_negative_n: 0 },
  };

  for (const app of apps) {
    const score = scoreByNum.get(app.num) ?? "";
    const band = bucketScore(score);
    const row = rows[band];
    row.n++;
    if (TERMINAL_POSITIVE.has(app.status)) row.terminal_positive_n++;
    else if (TERMINAL_STATUSES.has(app.status)) row.terminal_negative_n++;
    else row.in_flight_n++;
  }

  return (["high", "mid", "low", "unscored"] as const).map((b) => rows[b]);
}

// ── Response rates ────────────────────────────────────────────────────────────

export type ResponseRateSplit = {
  label: string;
  n_applied: number;
  n_responded: number;
  rate_pct: number | null; // null if n_applied = 0
};

/**
 * Response rate = apps that received a response (responded/interview/offer/hired)
 *                 ÷ apps that ever entered "applied" (have a status event toStatus=applied)
 * Splits: by letter tone and by resume attached vs not.
 * For covers, use the latest cover per num (by date desc, then file desc).
 */
export function computeResponseRates(
  apps: AppRow[],
  events: EventRow[],
  covers: CoverRow[],
): { by_letter_tone: ResponseRateSplit[]; by_resume: ResponseRateSplit[] } {
  // Apps that entered "applied"
  const appliedNums = new Set(
    events.filter((e) => e.toStatus === "applied").map((e) => e.num),
  );

  // Apps that received any response
  const respondedNums = new Set(
    events.filter((e) => RESPONSE_STATUSES.has(e.toStatus)).map((e) => e.num),
  );

  // Latest cover per num (date desc, then file desc as tiebreak)
  const latestCoverByNum = new Map<number, CoverRow>();
  for (const c of covers) {
    const existing = latestCoverByNum.get(c.num);
    if (
      !existing ||
      c.date > existing.date ||
      (c.date === existing.date && c.file > existing.file)
    ) {
      latestCoverByNum.set(c.num, c);
    }
  }

  const appByNum = new Map(apps.map((a) => [a.num, a]));

  // ── By letter tone ──────────────────────────────────────────────────────────
  const toneGroups = new Map<string, { applied: number; responded: number }>();
  for (const num of appliedNums) {
    const cover = latestCoverByNum.get(num);
    const tone = cover?.tone?.trim() || "no letter";
    if (!toneGroups.has(tone)) toneGroups.set(tone, { applied: 0, responded: 0 });
    const g = toneGroups.get(tone)!;
    g.applied++;
    if (respondedNums.has(num)) g.responded++;
  }

  const by_letter_tone: ResponseRateSplit[] = Array.from(toneGroups.entries())
    .map(([label, { applied, responded }]) => ({
      label,
      n_applied: applied,
      n_responded: responded,
      rate_pct: applied > 0 ? Math.round((responded / applied) * 100) : null,
    }))
    .sort((a, b) => b.n_applied - a.n_applied); // most common first

  // ── By resume presence ──────────────────────────────────────────────────────
  const resumeGroups = {
    yes: { applied: 0, responded: 0 },
    no: { applied: 0, responded: 0 },
  };
  for (const num of appliedNums) {
    const app = appByNum.get(num);
    const hasResume = !!(app?.resume && app.resume.trim());
    const key = hasResume ? "yes" : "no";
    resumeGroups[key].applied++;
    if (respondedNums.has(num)) resumeGroups[key].responded++;
  }

  const by_resume: ResponseRateSplit[] = (["yes", "no"] as const).map((key) => {
    const { applied, responded } = resumeGroups[key];
    return {
      label: key === "yes" ? "resume attached" : "no resume",
      n_applied: applied,
      n_responded: responded,
      rate_pct: applied > 0 ? Math.round((responded / applied) * 100) : null,
    };
  });

  return { by_letter_tone, by_resume };
}

// ── Velocity ──────────────────────────────────────────────────────────────────

export type VelocityHop = {
  from_stage: string;
  to_stage: string;
  n: number;
  median_days: number | null; // null if n = 0
};

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Median days between adjacent stage transitions, from StatusEvent dates.
 * Uses YYYY-MM-DD string comparison (LA-local dates from the Mac).
 */
export function computeVelocity(events: EventRow[]): VelocityHop[] {
  // Group events by app, sorted by date
  const byNum = new Map<number, EventRow[]>();
  for (const e of events) {
    if (!byNum.has(e.num)) byNum.set(e.num, []);
    byNum.get(e.num)!.push(e);
  }

  // Collect hop durations (days) by hop key
  const hopDays = new Map<string, number[]>();

  for (const appEvents of byNum.values()) {
    const sorted = appEvents.slice().sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 1; i < sorted.length; i++) {
      const fromStage = sorted[i - 1].toStatus;
      const toStage = sorted[i].toStatus;
      const key = `${fromStage}→${toStage}`;
      const fromDate = new Date(sorted[i - 1].date + "T12:00:00");
      const toDate = new Date(sorted[i].date + "T12:00:00");
      if (!isNaN(fromDate.getTime()) && !isNaN(toDate.getTime())) {
        const days = (toDate.getTime() - fromDate.getTime()) / 86_400_000;
        if (!hopDays.has(key)) hopDays.set(key, []);
        hopDays.get(key)!.push(Math.max(0, days));
      }
    }
  }

  // Only emit pipeline hops (evaluated→applied, applied→oa, etc.)
  return PIPELINE.slice(0, -1).map((stage, i) => {
    const nextStage = PIPELINE[i + 1];
    const key = `${stage}→${nextStage}`;
    const days = hopDays.get(key) ?? [];
    return {
      from_stage: stage,
      to_stage: nextStage,
      n: days.length,
      median_days: days.length > 0 ? median(days) : null,
    };
  });
}
