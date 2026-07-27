import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runOptimisticDelete, UNDO_WINDOW_MS, COMMIT_DELAY_MS } from "./optimisticDelete";

interface Item {
  id: number;
  company: string;
}

const A: Item = { id: 1, company: "Acme" };
const B: Item = { id: 2, company: "Beta" };
const C: Item = { id: 3, company: "Cyber" };

function makeHarness(overrides: Partial<Parameters<typeof runOptimisticDelete<Item>>[1]> = {}) {
  let cache: Item[] = [A, B, C];
  let undoFn: (() => void) | null = null;
  const deps = {
    prev: [...cache],
    getCache: () => cache,
    setCache: vi.fn((items: Item[]) => {
      cache = items;
    }),
    showUndoToast: vi.fn((onUndo: () => void) => {
      undoFn = onUndo;
    }),
    onRestored: vi.fn(),
    onError: vi.fn(),
    deleteApi: vi.fn(() => Promise.resolve({})),
    refresh: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
  return {
    deps,
    getCache: () => cache,
    undo: () => {
      if (!undoFn) throw new Error("Undo toast was never shown");
      undoFn();
    },
  };
}

describe("runOptimisticDelete", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("commit delay covers the full undo toast window", () => {
    expect(COMMIT_DELAY_MS).toBeGreaterThan(UNDO_WINDOW_MS);
  });

  it("removes the item from the cache immediately and shows the undo toast", () => {
    const h = makeHarness();
    void runOptimisticDelete(B, h.deps);
    expect(h.getCache()).toEqual([A, C]);
    expect(h.deps.showUndoToast).toHaveBeenCalledTimes(1);
    expect(h.deps.deleteApi).not.toHaveBeenCalled();
  });

  it("Undo restores the full previous list and skips the delete API", async () => {
    const h = makeHarness();
    const p = runOptimisticDelete(B, h.deps);

    // User clicks Undo within the window
    await vi.advanceTimersByTimeAsync(1000);
    h.undo();
    expect(h.getCache()).toEqual([A, B, C]);
    expect(h.deps.onRestored).toHaveBeenCalledTimes(1);

    // Let the commit timer elapse — the API must never be called
    await vi.advanceTimersByTimeAsync(COMMIT_DELAY_MS);
    await p;
    expect(h.deps.deleteApi).not.toHaveBeenCalled();
    expect(h.deps.refresh).not.toHaveBeenCalled();
    expect(h.deps.onError).not.toHaveBeenCalled();
    expect(h.getCache()).toEqual([A, B, C]);
  });

  it("Undo works even at the last moment before the commit delay fires", async () => {
    const h = makeHarness();
    const p = runOptimisticDelete(B, h.deps);

    await vi.advanceTimersByTimeAsync(COMMIT_DELAY_MS - 1);
    h.undo();
    await vi.advanceTimersByTimeAsync(1);
    await p;

    expect(h.getCache()).toEqual([A, B, C]);
    expect(h.deps.deleteApi).not.toHaveBeenCalled();
  });

  it("without Undo, calls the delete API with the item id and refreshes", async () => {
    const h = makeHarness();
    const p = runOptimisticDelete(B, h.deps);

    await vi.advanceTimersByTimeAsync(COMMIT_DELAY_MS);
    await p;

    expect(h.deps.deleteApi).toHaveBeenCalledTimes(1);
    expect(h.deps.deleteApi).toHaveBeenCalledWith(B.id);
    expect(h.deps.refresh).toHaveBeenCalledTimes(1);
    expect(h.deps.onError).not.toHaveBeenCalled();
    expect(h.getCache()).toEqual([A, C]);
  });

  it("rolls the item back and reports an error when the delete API fails", async () => {
    const h = makeHarness({
      deleteApi: vi.fn(() => Promise.reject(new Error("boom"))),
    });
    const p = runOptimisticDelete(B, h.deps);

    expect(h.getCache()).toEqual([A, C]); // optimistically removed
    await vi.advanceTimersByTimeAsync(COMMIT_DELAY_MS);
    await p;

    expect(h.getCache()).toEqual([A, B, C]); // rolled back
    expect(h.deps.onError).toHaveBeenCalledTimes(1);
    expect(h.deps.refresh).not.toHaveBeenCalled();
    expect(h.deps.onRestored).not.toHaveBeenCalled();
  });

  it("undoing one of two overlapping deletes restores only that item", async () => {
    // Shared cache across two overlapping runs.
    let cache: Item[] = [A, B, C];
    const getCache = () => cache;
    const setCache = (items: Item[]) => {
      cache = items;
    };
    const undoFns: Array<() => void> = [];
    const makeDeps = () => ({
      prev: [...cache],
      getCache,
      setCache,
      showUndoToast: (onUndo: () => void) => {
        undoFns.push(onUndo);
      },
      onRestored: vi.fn(),
      onError: vi.fn(),
      deleteApi: vi.fn(() => Promise.resolve({})),
      refresh: vi.fn(() => Promise.resolve()),
    });

    const depsA = makeDeps();
    const pA = runOptimisticDelete(A, depsA);
    expect(cache).toEqual([B, C]);

    await vi.advanceTimersByTimeAsync(1000);
    const depsB = makeDeps();
    const pB = runOptimisticDelete(B, depsB);
    expect(cache).toEqual([C]);

    // Undo A only — B must stay deleted.
    undoFns[0]!();
    expect(cache).toEqual([A, C]);

    await vi.advanceTimersByTimeAsync(COMMIT_DELAY_MS);
    await Promise.all([pA, pB]);

    // A's delete was skipped; B's committed.
    expect(depsA.deleteApi).not.toHaveBeenCalled();
    expect(depsB.deleteApi).toHaveBeenCalledWith(B.id);
    expect(cache).toEqual([A, C]);
  });

  it("failed delete rollback re-inserts only the failed item, not the snapshot", async () => {
    let cache: Item[] = [A, B, C];
    const getCache = () => cache;
    const setCache = (items: Item[]) => {
      cache = items;
    };
    const makeDeps = (deleteApi: () => Promise<unknown>) => ({
      prev: [...cache],
      getCache,
      setCache,
      showUndoToast: vi.fn(),
      onRestored: vi.fn(),
      onError: vi.fn(),
      deleteApi: vi.fn(deleteApi),
      refresh: vi.fn(() => Promise.resolve()),
    });

    // A's delete will fail; B's (started after) will succeed.
    const depsA = makeDeps(() => Promise.reject(new Error("boom")));
    const pA = runOptimisticDelete(A, depsA);
    const depsB = makeDeps(() => Promise.resolve({}));
    const pB = runOptimisticDelete(B, depsB);
    expect(cache).toEqual([C]);

    await vi.advanceTimersByTimeAsync(COMMIT_DELAY_MS);
    await Promise.all([pA, pB]);

    // Only A comes back (rollback); B stays deleted.
    expect(cache).toEqual([A, C]);
    expect(depsA.onError).toHaveBeenCalledTimes(1);
    expect(depsB.onError).not.toHaveBeenCalled();
  });

  it("respects an injected waitMs for the commit delay", async () => {
    const h = makeHarness({ waitMs: 50 });
    const p = runOptimisticDelete(B, h.deps);

    await vi.advanceTimersByTimeAsync(49);
    expect(h.deps.deleteApi).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(h.deps.deleteApi).toHaveBeenCalledWith(B.id);
  });
});
