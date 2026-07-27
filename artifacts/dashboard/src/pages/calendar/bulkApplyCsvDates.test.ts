import { describe, it, expect, vi } from "vitest";
import { runBulkApplyCsvDates, type BulkConflictRow } from "./bulkApplyCsvDates";

const row = (id: number, company: string): BulkConflictRow => ({
  existing_id: id,
  company,
  existing_opens_date: `2026-01-0${id}`,
  existing_closes_date: `2026-02-0${id}`,
  csv_opens_date: `2026-03-0${id}`,
  csv_closes_date: `2026-04-0${id}`,
});

const A = row(1, "Acme");
const B = row(2, "Beta");
const C = row(3, "Cyber");

function makeHarness(applyImpl?: (id: number, dates: { opens_date: string | null; closes_date: string | null }) => Promise<unknown>) {
  let undoFn: (() => void) | null = null;
  const deps = {
    applyApi: vi.fn(applyImpl ?? (() => Promise.resolve({}))),
    onRowApplied: vi.fn(),
    onRowRestored: vi.fn(),
    refresh: vi.fn(() => Promise.resolve()),
    showResultToast: vi.fn((_ok: number, _failed: BulkConflictRow[], onUndo: (() => void) | null) => {
      undoFn = onUndo;
    }),
    onUndone: vi.fn(),
  };
  return { deps, undo: () => undoFn?.(), getUndoFn: () => undoFn };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("runBulkApplyCsvDates", () => {
  it("applies CSV dates to every row and reports success", async () => {
    const h = makeHarness();
    await runBulkApplyCsvDates([A, B, C], h.deps);
    expect(h.deps.applyApi).toHaveBeenCalledTimes(3);
    expect(h.deps.applyApi).toHaveBeenCalledWith(1, { opens_date: A.csv_opens_date, closes_date: A.csv_closes_date });
    expect(h.deps.onRowApplied).toHaveBeenCalledTimes(3);
    expect(h.deps.refresh).toHaveBeenCalled();
    expect(h.deps.showResultToast).toHaveBeenCalledWith(3, [], expect.any(Function));
  });

  it("undo writes each row's previous dates back and re-adds rows to the panel", async () => {
    const h = makeHarness();
    await runBulkApplyCsvDates([A, B], h.deps);
    h.deps.applyApi.mockClear();
    h.undo();
    await flush();
    expect(h.deps.applyApi).toHaveBeenCalledWith(1, { opens_date: A.existing_opens_date, closes_date: A.existing_closes_date });
    expect(h.deps.applyApi).toHaveBeenCalledWith(2, { opens_date: B.existing_opens_date, closes_date: B.existing_closes_date });
    expect(h.deps.onRowRestored).toHaveBeenCalledTimes(2);
    expect(h.deps.onUndone).toHaveBeenCalledWith(2, []);
    expect(h.deps.refresh).toHaveBeenCalledTimes(2);
  });

  it("undo is idempotent — a second click does nothing", async () => {
    const h = makeHarness();
    await runBulkApplyCsvDates([A], h.deps);
    h.undo();
    h.undo();
    await flush();
    expect(h.deps.onUndone).toHaveBeenCalledTimes(1);
  });

  it("partial failure: only succeeded rows are undoable; failed rows stay untouched", async () => {
    // Row 2 fails on the forward run.
    const h = makeHarness((id, dates) =>
      id === 2 && dates.opens_date === B.csv_opens_date ? Promise.reject(new Error("boom")) : Promise.resolve({})
    );
    await runBulkApplyCsvDates([A, B, C], h.deps);
    expect(h.deps.onRowApplied).toHaveBeenCalledTimes(2);
    expect(h.deps.showResultToast).toHaveBeenCalledWith(2, [B], expect.any(Function));

    h.deps.applyApi.mockClear();
    h.undo();
    await flush();
    // Only rows 1 and 3 restored; row 2 never touched by undo.
    expect(h.deps.applyApi).toHaveBeenCalledTimes(2);
    expect(h.deps.applyApi).not.toHaveBeenCalledWith(2, expect.anything());
    expect(h.deps.onUndone).toHaveBeenCalledWith(2, []);
  });

  it("all rows fail: error toast with no undo action", async () => {
    const h = makeHarness(() => Promise.reject(new Error("boom")));
    await runBulkApplyCsvDates([A, B], h.deps);
    expect(h.deps.showResultToast).toHaveBeenCalledWith(0, [A, B], null);
    expect(h.getUndoFn()).toBeNull();
  });

  it("undo reports rows that fail to restore", async () => {
    let phase = "forward";
    const h = makeHarness((id) =>
      phase === "undo" && id === 1 ? Promise.reject(new Error("boom")) : Promise.resolve({})
    );
    await runBulkApplyCsvDates([A, B], h.deps);
    phase = "undo";
    h.undo();
    await flush();
    expect(h.deps.onUndone).toHaveBeenCalledWith(1, [A]);
    expect(h.deps.onRowRestored).toHaveBeenCalledTimes(1);
  });
});
