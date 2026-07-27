import { describe, it, expect } from "vitest";
import { chooseSoonestAlert } from "../lib/seasonAlert";

const TODAY = "2026-07-27";
const WINDOW_END = "2026-08-03"; // TODAY + 7 days

describe("chooseSoonestAlert", () => {
  it("returns null when rows is empty", () => {
    expect(chooseSoonestAlert([], TODAY, WINDOW_END)).toBeNull();
  });

  it("picks the opens date when it is the only in-window event", () => {
    const result = chooseSoonestAlert(
      [{ id: 1, company: "FAANG", program: "SWE", opensDate: "2026-07-29", closesDate: null }],
      TODAY,
      WINDOW_END,
    );
    expect(result).toEqual({
      id: 1,
      company: "FAANG",
      program: "SWE",
      kind: "opens",
      date: "2026-07-29",
    });
  });

  it("picks the closes date when it is the only in-window event", () => {
    const result = chooseSoonestAlert(
      [{ id: 2, company: "Corp", program: "Intern", opensDate: null, closesDate: "2026-08-01" }],
      TODAY,
      WINDOW_END,
    );
    expect(result).toEqual({
      id: 2,
      company: "Corp",
      program: "Intern",
      kind: "closes",
      date: "2026-08-01",
    });
  });

  // Bug regression: past opensDate must NOT beat an in-window closesDate
  it("ignores a past opensDate and correctly returns an in-window closesDate", () => {
    const result = chooseSoonestAlert(
      [
        {
          id: 3,
          company: "OldOpen",
          program: "ML",
          opensDate: "2026-06-01", // past — out of window
          closesDate: "2026-07-30", // in window
        },
      ],
      TODAY,
      WINDOW_END,
    );
    expect(result).toEqual({
      id: 3,
      company: "OldOpen",
      program: "ML",
      kind: "closes",
      date: "2026-07-30",
    });
  });

  // Bug regression: row B's sooner in-window deadline beats row A's past date
  it("picks the row with the sooner in-window date over a row that only has a past opens", () => {
    const result = chooseSoonestAlert(
      [
        {
          id: 10,
          company: "A",
          program: "Summer",
          opensDate: "2026-05-01", // past — excluded
          closesDate: "2026-07-31", // in window
        },
        {
          id: 20,
          company: "B",
          program: "Fall",
          opensDate: "2026-07-28", // in window, sooner than row A's closes
          closesDate: null,
        },
      ],
      TODAY,
      WINDOW_END,
    );
    // Row B opens 2026-07-28 < Row A closes 2026-07-31
    expect(result).toEqual({
      id: 20,
      company: "B",
      program: "Fall",
      kind: "opens",
      date: "2026-07-28",
    });
  });

  it("when a row has both dates in window, picks the sooner one", () => {
    const result = chooseSoonestAlert(
      [
        {
          id: 5,
          company: "Dual",
          program: "Co-op",
          opensDate: "2026-08-02",
          closesDate: "2026-07-29", // sooner
        },
      ],
      TODAY,
      WINDOW_END,
    );
    expect(result).toEqual({
      id: 5,
      company: "Dual",
      program: "Co-op",
      kind: "closes",
      date: "2026-07-29",
    });
  });

  it("among multiple rows returns the one with the soonest in-window event", () => {
    const result = chooseSoonestAlert(
      [
        { id: 1, company: "Late", program: "P", opensDate: "2026-08-02", closesDate: null },
        { id: 2, company: "Soon", program: "Q", opensDate: "2026-07-28", closesDate: null },
        { id: 3, company: "Mid", program: "R", opensDate: "2026-07-30", closesDate: null },
      ],
      TODAY,
      WINDOW_END,
    );
    expect(result?.id).toBe(2);
    expect(result?.date).toBe("2026-07-28");
  });

  it("returns null when all rows have only out-of-window dates", () => {
    const result = chooseSoonestAlert(
      [
        { id: 1, company: "Past", program: "P", opensDate: "2026-06-01", closesDate: "2026-05-01" },
        { id: 2, company: "Future", program: "F", opensDate: "2026-09-01", closesDate: null },
      ],
      TODAY,
      WINDOW_END,
    );
    expect(result).toBeNull();
  });
});
