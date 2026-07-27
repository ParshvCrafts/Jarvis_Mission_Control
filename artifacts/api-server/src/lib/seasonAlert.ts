/**
 * Pure helper for season-alert selection.
 * Extracted from the today route so it can be unit-tested independently.
 */

type AlertRow = {
  id: number;
  company: string;
  program: string;
  opensDate: string | null;
  closesDate: string | null;
};

export type AlertResult = {
  id: number;
  company: string;
  program: string;
  kind: "opens" | "closes";
  date: string;
};

/**
 * Choose the single soonest upcoming season event from a set of rows,
 * where at least one of opensDate/closesDate falls within [todayLA, windowEnd].
 *
 * A past opensDate (< todayLA) is excluded even if it would otherwise
 * win a LEAST comparison, so only genuinely upcoming events are ranked.
 */
export function chooseSoonestAlert(
  rows: AlertRow[],
  todayLA: string,
  windowEnd: string,
): AlertResult | null {
  let best: AlertResult | null = null;

  for (const row of rows) {
    // Collect in-window candidate events for this row only
    const candidates: Array<{ kind: "opens" | "closes"; date: string }> = [];

    if (row.opensDate && row.opensDate >= todayLA && row.opensDate <= windowEnd) {
      candidates.push({ kind: "opens", date: row.opensDate });
    }
    if (row.closesDate && row.closesDate >= todayLA && row.closesDate <= windowEnd) {
      candidates.push({ kind: "closes", date: row.closesDate });
    }

    if (candidates.length === 0) continue;

    // Pick the sooner candidate event within this row
    candidates.sort((a, b) => a.date.localeCompare(b.date));
    const rowBest = candidates[0];

    // Compare with the running best across all rows
    if (!best || rowBest.date < best.date) {
      best = {
        id: row.id,
        company: row.company,
        program: row.program,
        kind: rowBest.kind,
        date: rowBest.date,
      };
    }
  }

  return best;
}
