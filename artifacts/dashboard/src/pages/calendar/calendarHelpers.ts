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
  // Stable order: earlier opens first, then longer windows
  raw.sort((a, b) =>
    (a.d.opens_date! + a.d.closes_date!).localeCompare(b.d.opens_date! + b.d.closes_date!) || a.d.id - b.d.id
  );
  const laneEnds: number[] = []; // per lane, last occupied column
  return raw.map((seg) => {
    let lane = laneEnds.findIndex((end) => end < seg.startCol);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(seg.endCol);
    } else {
      laneEnds[lane] = seg.endCol;
    }
    return { ...seg, lane };
  });
}
