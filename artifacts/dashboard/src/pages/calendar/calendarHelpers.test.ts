import { describe, it, expect } from "vitest";
import {
  buildMonthGrid,
  isoDay,
  isWindowDeadline,
  computeWeekSegments,
  type WindowDeadlineLike,
} from "./calendarHelpers";

// ─── Test utilities ───────────────────────────────────────────────────────────

let nextId = 1;
function win(opens: string | null, closes: string | null): WindowDeadlineLike {
  return { id: nextId++, opens_date: opens, closes_date: closes };
}

/** Build the week rows of ISO strings for a month, same as CalendarPage does. */
function monthWeeks(year: number, month: number): (string | null)[][] {
  const grid = buildMonthGrid(year, month);
  const weeks: (string | null)[][] = [];
  for (let w = 0; w < grid.length / 7; w++) {
    weeks.push(
      grid.slice(w * 7, w * 7 + 7).map((d) => (d ? isoDay(year, month, d) : null)),
    );
  }
  return weeks;
}

// ─── buildMonthGrid ───────────────────────────────────────────────────────────

describe("buildMonthGrid", () => {
  it("pads leading nulls to the first weekday and trailing nulls to a full week", () => {
    // July 2026 starts on Wednesday (day 3) and has 31 days
    const grid = buildMonthGrid(2026, 6);
    expect(grid.length % 7).toBe(0);
    expect(grid.slice(0, 3)).toEqual([null, null, null]);
    expect(grid[3]).toBe(1);
    expect(grid[33]).toBe(31);
    expect(grid.slice(34).every((d) => d === null)).toBe(true);
  });

  it("handles a month starting on Sunday with no leading padding", () => {
    // Feb 2026 starts on Sunday and has 28 days => exactly 4 weeks
    const grid = buildMonthGrid(2026, 1);
    expect(grid[0]).toBe(1);
    expect(grid.length).toBe(28);
  });

  it("handles leap-year February", () => {
    const grid = buildMonthGrid(2028, 1); // Feb 2028, 29 days
    expect(grid.filter((d) => d !== null).length).toBe(29);
    expect(grid.length % 7).toBe(0);
  });
});

// ─── isoDay ───────────────────────────────────────────────────────────────────

describe("isoDay", () => {
  it("zero-pads month and day", () => {
    expect(isoDay(2026, 0, 5)).toBe("2026-01-05");
    expect(isoDay(2026, 11, 31)).toBe("2026-12-31");
  });
});

// ─── isWindowDeadline ─────────────────────────────────────────────────────────

describe("isWindowDeadline", () => {
  it("requires both dates present", () => {
    expect(isWindowDeadline(win("2026-07-01", null))).toBe(false);
    expect(isWindowDeadline(win(null, "2026-07-10"))).toBe(false);
    expect(isWindowDeadline(win(null, null))).toBe(false);
  });

  it("accepts opens == closes (single-day window)", () => {
    expect(isWindowDeadline(win("2026-07-05", "2026-07-05"))).toBe(true);
  });

  it("rejects inverted windows (opens after closes)", () => {
    expect(isWindowDeadline(win("2026-07-10", "2026-07-01"))).toBe(false);
  });
});

// ─── computeWeekSegments ──────────────────────────────────────────────────────

describe("computeWeekSegments", () => {
  it("spans multiple weeks with correct clipping and start/end flags", () => {
    // July 2026: 1st is Wednesday. Window Jul 3 (Fri) → Jul 15 (Wed)
    const weeks = monthWeeks(2026, 6);
    const d = win("2026-07-03", "2026-07-15");

    // Week 0: Jul 1–4 in cols 3–6; window starts Fri (col 5), runs to Sat (col 6)
    const w0 = computeWeekSegments(weeks[0]!, [d]);
    expect(w0).toHaveLength(1);
    expect(w0[0]).toMatchObject({ startCol: 5, endCol: 6, startsHere: true, endsHere: false });

    // Week 1: Jul 5–11, fully inside the window
    const w1 = computeWeekSegments(weeks[1]!, [d]);
    expect(w1[0]).toMatchObject({ startCol: 0, endCol: 6, startsHere: false, endsHere: false });

    // Week 2: Jul 12–18; window ends Wed Jul 15 (col 3)
    const w2 = computeWeekSegments(weeks[2]!, [d]);
    expect(w2[0]).toMatchObject({ startCol: 0, endCol: 3, startsHere: false, endsHere: true });
  });

  it("produces no segments when the window is entirely outside the visible month", () => {
    const weeks = monthWeeks(2026, 6); // July 2026
    const d = win("2026-09-01", "2026-09-20");
    for (const week of weeks) {
      expect(computeWeekSegments(week, [d])).toHaveLength(0);
    }
  });

  it("renders a single-day window (opens == closes) as a one-column segment", () => {
    const weeks = monthWeeks(2026, 6);
    const d = win("2026-07-08", "2026-07-08"); // Wednesday of week 1
    const segs = computeWeekSegments(weeks[1]!, [d]);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ startCol: 3, endCol: 3, startsHere: true, endsHere: true });
    // No bleed into the adjacent weeks
    expect(computeWeekSegments(weeks[0]!, [d])).toHaveLength(0);
    expect(computeWeekSegments(weeks[2]!, [d])).toHaveLength(0);
  });

  it("assigns distinct lanes to overlapping windows and reuses free lanes", () => {
    const weeks = monthWeeks(2026, 6);
    const a = win("2026-07-05", "2026-07-07"); // cols 0–2 of week 1
    const b = win("2026-07-06", "2026-07-10"); // cols 1–5, overlaps a
    const c = win("2026-07-09", "2026-07-11"); // cols 4–6, overlaps b but not a
    const segs = computeWeekSegments(weeks[1]!, [a, b, c]);
    expect(segs).toHaveLength(3);
    const byId = new Map(segs.map((s) => [s.d.id, s]));
    expect(byId.get(a.id)!.lane).toBe(0);
    expect(byId.get(b.id)!.lane).toBe(1);
    // c starts after a ended, so it should reuse lane 0
    expect(byId.get(c.id)!.lane).toBe(0);
    // Overlapping segments never share a lane
    expect(byId.get(b.id)!.lane).not.toBe(byId.get(c.id)!.lane);
  });

  it("clips bands at the first partial week (null leading cells)", () => {
    // July 2026 week 0 is [null,null,null, 1, 2, 3, 4]
    const weeks = monthWeeks(2026, 6);
    // Window straddling the month start: Jun 28 → Jul 2
    const d = win("2026-06-28", "2026-07-02");
    const segs = computeWeekSegments(weeks[0]!, [d]);
    expect(segs).toHaveLength(1);
    // Only Jul 1 (col 3) and Jul 2 (col 4) are visible; nulls never match
    expect(segs[0]).toMatchObject({ startCol: 3, endCol: 4, startsHere: false, endsHere: true });
  });

  it("clips bands at the last partial week (null trailing cells)", () => {
    // July 2026 last week: Jul 26–31 in cols 0–5, col 6 null
    const weeks = monthWeeks(2026, 6);
    const lastWeek = weeks[weeks.length - 1]!;
    // Window straddling the month end: Jul 30 → Aug 5
    const d = win("2026-07-30", "2026-08-05");
    const segs = computeWeekSegments(lastWeek, [d]);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ startCol: 4, endCol: 5, startsHere: true, endsHere: false });
  });

  it("orders segments by opens date then window end, breaking ties by id", () => {
    const weeks = monthWeeks(2026, 6);
    const later = win("2026-07-08", "2026-07-09");
    const earlier = win("2026-07-05", "2026-07-09");
    const segs = computeWeekSegments(weeks[1]!, [later, earlier]);
    expect(segs[0]!.d.id).toBe(earlier.id);
    expect(segs[1]!.d.id).toBe(later.id);
  });
});
