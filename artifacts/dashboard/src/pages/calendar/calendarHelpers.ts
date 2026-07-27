// Pure helpers for the calendar month grid and window bands.
// Kept free of React/UI imports so they can be unit-tested directly.

/** Minimal structural shape of a deadline used by the band math. */
export interface WindowDeadlineLike {
  id: number;
  opens_date?: string | null;
  closes_date?: string | null;
}

export function buildMonthGrid(year: number, month: number) {
  // month: 0-indexed
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const grid: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) grid.push(null);
  for (let d = 1; d <= daysInMonth; d++) grid.push(d);
  while (grid.length % 7 !== 0) grid.push(null);
  return grid;
}

export function isoDay(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ─── Urgency / date-math display helpers ─────────────────────────────────────

/** Today's date as YYYY-MM-DD in America/Los_Angeles. */
export function todayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

/**
 * Whole days between `today` (YYYY-MM-DD) and `iso` (YYYY-MM-DD).
 * Negative = past, 0 = today, positive = future. Null when the date is missing.
 */
export function daysFromNow(iso: string | null | undefined, today: string): number | null {
  if (!iso) return null;
  const todayMs = new Date(today + "T12:00:00").getTime();
  const targetMs = new Date(iso + "T12:00:00").getTime();
  return Math.round((targetMs - todayMs) / 86_400_000);
}

/** Text color class for a date given days until it (list view). */
export function urgencyClass(days: number | null): string {
  if (days === null) return "text-zinc-600";
  if (days < 0) return "text-zinc-700 line-through";
  if (days <= 3) return "text-red-400";
  if (days <= 7) return "text-amber-400";
  if (days <= 14) return "text-yellow-500";
  return "text-zinc-500";
}

/** Relative label: "3d ago" / "today" / "in 3d". Empty when days is null. */
export function daysLabel(days: number | null): string {
  if (days === null) return "";
  if (days < 0) return `${Math.abs(days)}d ago`;
  if (days === 0) return "today";
  return `in ${days}d`;
}

/** Urgency color for a window band, based on days until close. */
export function bandColorClass(closesDays: number | null): string {
  if (closesDays === null || closesDays < 0)
    return "bg-zinc-800/60 text-zinc-500 ring-zinc-700/60 hover:bg-zinc-800";
  if (closesDays <= 3)
    return "bg-red-900/60 text-red-300 ring-red-700/60 hover:bg-red-900/80";
  if (closesDays <= 14)
    return "bg-amber-900/60 text-amber-300 ring-amber-700/60 hover:bg-amber-900/80";
  return "bg-emerald-900/60 text-emerald-300 ring-emerald-700/60 hover:bg-emerald-900/80";
}

export interface BandSegment<D extends WindowDeadlineLike = WindowDeadlineLike> {
  d: D;
  startCol: number;
  endCol: number; // inclusive
  lane: number;
  startsHere: boolean; // opens_date falls within this week
  endsHere: boolean; // closes_date falls within this week
}

/** Deadlines that render as bands: both dates present and opens <= closes. */
export function isWindowDeadline(d: WindowDeadlineLike): boolean {
  return !!d.opens_date && !!d.closes_date && d.opens_date <= d.closes_date;
}

/**
 * Compute band segments for one week row. Each segment covers the contiguous
 * columns whose date falls inside [opens_date, closes_date]. Lanes are assigned
 * greedily so overlapping windows stack instead of colliding.
 */
export function computeWeekSegments<D extends WindowDeadlineLike>(
  weekIsos: (string | null)[],
  windowDeadlines: D[],
): BandSegment<D>[] {
  const raw: Omit<BandSegment<D>, "lane">[] = [];
  for (const d of windowDeadlines) {
    let startCol = -1;
    let endCol = -1;
    for (let c = 0; c < 7; c++) {
      const iso = weekIsos[c];
      if (iso && iso >= d.opens_date! && iso <= d.closes_date!) {
        if (startCol === -1) startCol = c;
        endCol = c;
      }
    }
    if (startCol === -1) continue;
    raw.push({
      d,
      startCol,
      endCol,
      startsHere: weekIsos.includes(d.opens_date!),
      endsHere: weekIsos.includes(d.closes_date!),
    });
  }
  // Urgency order: soonest-closing windows first so they get the lowest lanes
  // (visible ones when the week overflows). Ties break by opens date, then id.
  raw.sort((a, b) =>
    a.d.closes_date!.localeCompare(b.d.closes_date!) ||
    a.d.opens_date!.localeCompare(b.d.opens_date!) ||
    a.d.id - b.d.id
  );
  // First-fit lane assignment with full interval-overlap checks (segments are
  // no longer sorted by start column, so a simple "last end" per lane is not enough).
  const lanes: { startCol: number; endCol: number }[][] = [];
  return raw.map((seg) => {
    let lane = lanes.findIndex((ivs) =>
      ivs.every((iv) => iv.endCol < seg.startCol || iv.startCol > seg.endCol)
    );
    if (lane === -1) {
      lane = lanes.length;
      lanes.push([]);
    }
    lanes[lane]!.push({ startCol: seg.startCol, endCol: seg.endCol });
    return { ...seg, lane };
  });
}
