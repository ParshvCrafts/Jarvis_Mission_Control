import { describe, it, expect } from "vitest";
import {
  buildMonthGrid,
  isoDay,
  isWindowDeadline,
  computeWeekSegments,
  splitWeekLanes,
  type BandSegment,
  daysFromNow,
  urgencyClass,
  daysLabel,
  bandColorClass,
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

  it("orders segments by closes date (urgency), breaking ties by opens date then id", () => {
    const weeks = monthWeeks(2026, 6);
    const later = win("2026-07-08", "2026-07-09");
    const earlier = win("2026-07-05", "2026-07-09");
    const segs = computeWeekSegments(weeks[1]!, [later, earlier]);
    // Same closes date → earlier opens first
    expect(segs[0]!.d.id).toBe(earlier.id);
    expect(segs[1]!.d.id).toBe(later.id);
  });

  it("gives soonest-closing windows the lowest lanes so they stay visible on overflow", () => {
    const weeks = monthWeeks(2026, 6);
    // Five overlapping windows spanning all of week 1; urgency = closes date.
    const farOff = win("2026-07-05", "2026-08-20");
    const soon = win("2026-07-05", "2026-07-09");
    const mid1 = win("2026-07-05", "2026-07-20");
    const mid2 = win("2026-07-05", "2026-07-25");
    const soonest = win("2026-07-05", "2026-07-07");
    const segs = computeWeekSegments(weeks[1]!, [farOff, soon, mid1, mid2, soonest]);
    const laneOf = new Map(segs.map((s) => [s.d.id, s.lane]));
    expect(laneOf.get(soonest.id)).toBe(0);
    expect(laneOf.get(soon.id)).toBe(1);
    expect(laneOf.get(mid1.id)).toBe(2);
    expect(laneOf.get(mid2.id)).toBe(3);
    // Least urgent gets the highest lane → hidden behind "+N more" with a 4-lane cap
    expect(laneOf.get(farOff.id)).toBe(4);
    // No overlapping segments share a lane
    const byLane = new Map<number, { startCol: number; endCol: number }[]>();
    for (const s of segs) {
      const arr = byLane.get(s.lane) ?? [];
      for (const iv of arr) {
        expect(s.endCol < iv.startCol || s.startCol > iv.endCol).toBe(true);
      }
      arr.push(s);
      byLane.set(s.lane, arr);
    }
  });

  it("sorts already-closed windows after upcoming ones in lane assignment", () => {
    const weeks = monthWeeks(2026, 6);
    const today = "2026-07-08"; // Wednesday of week 1
    // All overlap all of week 1 → forced into distinct lanes.
    const expired1 = win("2026-07-01", "2026-07-06"); // closed 2d ago
    const expired2 = win("2026-07-01", "2026-07-07"); // closed 1d ago
    const upcomingSoon = win("2026-07-05", "2026-07-10");
    const upcomingLate = win("2026-07-05", "2026-07-25");
    const segs = computeWeekSegments(
      weeks[1]!,
      [expired1, expired2, upcomingSoon, upcomingLate],
      today,
    );
    const laneOf = new Map(segs.map((s) => [s.d.id, s.lane]));
    // Upcoming windows claim the lowest (visible) lanes...
    expect(laneOf.get(upcomingSoon.id)).toBe(0);
    expect(laneOf.get(upcomingLate.id)).toBe(1);
    // ...expired windows sort after, still ordered by closes date among themselves
    expect(laneOf.get(expired1.id)).toBe(2);
    expect(laneOf.get(expired2.id)).toBe(3);
  });

  it("treats a window closing today as upcoming, not expired", () => {
    const weeks = monthWeeks(2026, 6);
    const today = "2026-07-08";
    const closesToday = win("2026-07-05", "2026-07-08");
    const future = win("2026-07-05", "2026-07-09");
    const segs = computeWeekSegments(weeks[1]!, [future, closesToday], today);
    const laneOf = new Map(segs.map((s) => [s.d.id, s.lane]));
    expect(laneOf.get(closesToday.id)).toBe(0);
    expect(laneOf.get(future.id)).toBe(1);
  });

  it("keeps pure closes-date ordering when no today reference is given", () => {
    const weeks = monthWeeks(2026, 6);
    const early = win("2026-07-05", "2026-07-06");
    const late = win("2026-07-05", "2026-07-20");
    const segs = computeWeekSegments(weeks[1]!, [late, early]);
    const laneOf = new Map(segs.map((s) => [s.d.id, s.lane]));
    expect(laneOf.get(early.id)).toBe(0);
    expect(laneOf.get(late.id)).toBe(1);
  });

  it("reuses lower lanes for less urgent windows when they don't collide", () => {
    const weeks = monthWeeks(2026, 6);
    const urgent = win("2026-07-05", "2026-07-06"); // cols 0–1
    const laterButFree = win("2026-07-09", "2026-08-15"); // cols 4–6, far-off close
    const segs = computeWeekSegments(weeks[1]!, [laterButFree, urgent]);
    const laneOf = new Map(segs.map((s) => [s.d.id, s.lane]));
    // No collision → both fit on lane 0 despite different urgency
    expect(laneOf.get(urgent.id)).toBe(0);
    expect(laneOf.get(laterButFree.id)).toBe(0);
  });
});

// ─── splitWeekLanes ───────────────────────────────────────────────────────────

describe("splitWeekLanes", () => {
  /** Build a full-width segment on a given lane with a given closes date. */
  function seg(lane: number, closes: string | null, opens = "2026-07-05"): BandSegment {
    return {
      d: { id: nextId++, opens_date: opens, closes_date: closes },
      startCol: 0,
      endCol: 6,
      lane,
      startsHere: true,
      endsHere: true,
    };
  }

  it("returns everything visible with no overflow when lanes fit the cap", () => {
    const segs = [seg(0, "2026-07-10"), seg(1, "2026-07-12")];
    const res = splitWeekLanes(segs, 4);
    expect(res.segments).toEqual(segs);
    expect(res.hiddenSegments).toEqual([]);
    expect(res.laneCount).toBe(2);
  });

  it("handles an empty week", () => {
    const res = splitWeekLanes([], 4);
    expect(res.segments).toEqual([]);
    expect(res.hiddenSegments).toEqual([]);
    expect(res.laneCount).toBe(0);
  });

  it("returns no overflow when lanes exactly hit the cap", () => {
    const segs = [seg(0, "2026-07-10"), seg(1, "2026-07-11"), seg(2, "2026-07-12"), seg(3, "2026-07-13")];
    const res = splitWeekLanes(segs, 4);
    expect(res.hiddenSegments).toEqual([]);
    expect(res.laneCount).toBe(4);
  });

  it("splits overflow lanes and reserves an extra lane row for the indicator", () => {
    const segs = [seg(0, "2026-07-08"), seg(1, "2026-07-10"), seg(2, "2026-07-12"), seg(3, "2026-07-14"), seg(4, "2026-07-20"), seg(5, "2026-07-25")];
    const res = splitWeekLanes(segs, 4);
    expect(res.segments.map((s) => s.lane)).toEqual([0, 1, 2, 3]);
    expect(res.hiddenSegments).toHaveLength(2);
    expect(res.laneCount).toBe(5); // 4 visible + "+N more" row
  });

  it("sorts overflow by closes_date ascending", () => {
    const late = seg(4, "2026-08-20");
    const soon = seg(5, "2026-07-09");
    const mid = seg(6, "2026-07-30");
    const res = splitWeekLanes([seg(0, "2026-07-08"), seg(1, "2026-07-08"), seg(2, "2026-07-08"), seg(3, "2026-07-08"), late, soon, mid], 4);
    expect(res.hiddenSegments.map((s) => s.d.id)).toEqual([soon.d.id, mid.d.id, late.d.id]);
  });

  it("sorts null closes_date last in the overflow list", () => {
    const noClose = seg(4, null);
    const dated = seg(5, "2026-07-09");
    const res = splitWeekLanes([seg(0, "2026-07-08"), seg(1, "2026-07-08"), seg(2, "2026-07-08"), seg(3, "2026-07-08"), noClose, dated], 4);
    expect(res.hiddenSegments.map((s) => s.d.id)).toEqual([dated.d.id, noClose.d.id]);
  });

  it("sorts already-closed windows after upcoming ones in the overflow list", () => {
    const today = "2026-07-15";
    const expiredSoonest = seg(4, "2026-07-06"); // closed — earliest closes date overall
    const upcoming = seg(5, "2026-07-20");
    const expiredLater = seg(6, "2026-07-10");
    const res = splitWeekLanes(
      [seg(0, "2026-07-16"), seg(1, "2026-07-16"), seg(2, "2026-07-16"), seg(3, "2026-07-16"), expiredSoonest, upcoming, expiredLater],
      4,
      today,
    );
    // Upcoming first, then expired ordered by closes date among themselves
    expect(res.hiddenSegments.map((s) => s.d.id)).toEqual([
      upcoming.d.id,
      expiredSoonest.d.id,
      expiredLater.d.id,
    ]);
  });

  it("keeps null closes_date last even with a today reference", () => {
    const today = "2026-07-15";
    const noClose = seg(4, null);
    const expired = seg(5, "2026-07-01");
    const upcoming = seg(6, "2026-07-20");
    const res = splitWeekLanes(
      [seg(0, "2026-07-16"), seg(1, "2026-07-16"), seg(2, "2026-07-16"), seg(3, "2026-07-16"), noClose, expired, upcoming],
      4,
      today,
    );
    expect(res.hiddenSegments.map((s) => s.d.id)).toEqual([upcoming.d.id, noClose.d.id, expired.d.id]);
  });

  it("does not mutate the input segment array", () => {
    const segs = [seg(5, "2026-07-09"), seg(4, "2026-08-01"), seg(0, "2026-07-08"), seg(1, "2026-07-08"), seg(2, "2026-07-08"), seg(3, "2026-07-08")];
    const copy = [...segs];
    splitWeekLanes(segs, 4);
    expect(segs).toEqual(copy);
  });
});

// ─── daysFromNow ──────────────────────────────────────────────────────────────

const TODAY = "2026-07-27";

describe("daysFromNow", () => {
  it("returns null for missing dates", () => {
    expect(daysFromNow(null, TODAY)).toBeNull();
    expect(daysFromNow(undefined, TODAY)).toBeNull();
    expect(daysFromNow("", TODAY)).toBeNull();
  });

  it("returns 0 for today", () => {
    expect(daysFromNow(TODAY, TODAY)).toBe(0);
  });

  it("returns positive counts for future dates", () => {
    expect(daysFromNow("2026-07-28", TODAY)).toBe(1);
    expect(daysFromNow("2026-07-30", TODAY)).toBe(3);
    expect(daysFromNow("2026-08-03", TODAY)).toBe(7);
    expect(daysFromNow("2026-08-10", TODAY)).toBe(14);
  });

  it("returns negative counts for past dates", () => {
    expect(daysFromNow("2026-07-26", TODAY)).toBe(-1);
    expect(daysFromNow("2026-07-20", TODAY)).toBe(-7);
  });

  it("counts whole days across month and year boundaries", () => {
    expect(daysFromNow("2026-08-01", "2026-07-31")).toBe(1);
    expect(daysFromNow("2027-01-01", "2026-12-31")).toBe(1);
  });

  it("is unaffected by DST transitions (noon-anchored)", () => {
    // US DST ends Nov 1, 2026 (25-hour day in America/Los_Angeles)
    expect(daysFromNow("2026-11-02", "2026-10-31")).toBe(2);
    // DST starts Mar 8, 2026 (23-hour day)
    expect(daysFromNow("2026-03-09", "2026-03-07")).toBe(2);
  });
});

// ─── urgencyClass ─────────────────────────────────────────────────────────────

describe("urgencyClass", () => {
  it("returns muted class for null", () => {
    expect(urgencyClass(null)).toBe("text-zinc-600");
  });

  it("strikes through past dates", () => {
    expect(urgencyClass(-1)).toBe("text-zinc-700 line-through");
    expect(urgencyClass(-30)).toBe("text-zinc-700 line-through");
  });

  it("marks today through 3 days as red", () => {
    expect(urgencyClass(0)).toBe("text-red-400");
    expect(urgencyClass(3)).toBe("text-red-400");
  });

  it("marks 4–7 days as amber", () => {
    expect(urgencyClass(4)).toBe("text-amber-400");
    expect(urgencyClass(7)).toBe("text-amber-400");
  });

  it("marks 8–14 days as yellow", () => {
    expect(urgencyClass(8)).toBe("text-yellow-500");
    expect(urgencyClass(14)).toBe("text-yellow-500");
  });

  it("marks beyond 14 days as neutral", () => {
    expect(urgencyClass(15)).toBe("text-zinc-500");
    expect(urgencyClass(100)).toBe("text-zinc-500");
  });
});

// ─── daysLabel ────────────────────────────────────────────────────────────────

describe("daysLabel", () => {
  it("returns empty string for null", () => {
    expect(daysLabel(null)).toBe("");
  });

  it('labels today as "today"', () => {
    expect(daysLabel(0)).toBe("today");
  });

  it('labels future dates as "in Xd"', () => {
    expect(daysLabel(1)).toBe("in 1d");
    expect(daysLabel(14)).toBe("in 14d");
  });

  it('labels past dates as "Xd ago"', () => {
    expect(daysLabel(-1)).toBe("1d ago");
    expect(daysLabel(-10)).toBe("10d ago");
  });
});

// ─── bandColorClass ───────────────────────────────────────────────────────────

describe("bandColorClass", () => {
  it("renders null and past closes as muted zinc", () => {
    expect(bandColorClass(null)).toContain("bg-zinc-800/60");
    expect(bandColorClass(-1)).toContain("bg-zinc-800/60");
  });

  it("renders today through 3 days as red", () => {
    expect(bandColorClass(0)).toContain("bg-red-900/60");
    expect(bandColorClass(3)).toContain("bg-red-900/60");
  });

  it("renders 4–14 days as amber", () => {
    expect(bandColorClass(4)).toContain("bg-amber-900/60");
    expect(bandColorClass(14)).toContain("bg-amber-900/60");
  });

  it("renders beyond 14 days as emerald", () => {
    expect(bandColorClass(15)).toContain("bg-emerald-900/60");
  });
});
