// Optimistic delete-with-undo flow, extracted from CalendarPage so it can be
// unit-tested. The item is removed from the cache immediately, an undo toast
// is shown for UNDO_WINDOW_MS; if the user hits Undo the cache is restored and
// the API call is skipped, otherwise the delete API runs. On API failure the
// cache is rolled back and an error is surfaced.

export const UNDO_WINDOW_MS = 5000;
/** Small buffer past the toast duration before committing the delete. */
export const COMMIT_DELAY_MS = UNDO_WINDOW_MS + 200;

export interface OptimisticDeleteDeps<T extends { id: number }> {
  /** Snapshot of the current list (taken before removal). */
  prev: T[];
  /** Write the deadlines list into the query cache. */
  setCache: (items: T[]) => void;
  /** Show the "Deleted: X" toast with an Undo action. */
  showUndoToast: (onUndo: () => void) => void;
  /** Called after Undo restores the item. */
  onRestored: () => void;
  /** Called when the delete API fails (after rollback). */
  onError: () => void;
  /** Perform the actual delete API call. */
  deleteApi: (id: number) => Promise<unknown>;
  /** Refetch/invalidate after a successful delete. */
  refresh: () => Promise<void>;
  /** Delay before committing; injectable for tests. */
  waitMs?: number;
}

export async function runOptimisticDelete<T extends { id: number }>(
  d: T,
  deps: OptimisticDeleteDeps<T>,
): Promise<void> {
  const { prev, setCache, showUndoToast, onRestored, onError, deleteApi, refresh } = deps;
  const waitMs = deps.waitMs ?? COMMIT_DELAY_MS;

  // Optimistically remove the item.
  setCache(prev.filter((x) => x.id !== d.id));

  let undone = false;
  showUndoToast(() => {
    undone = true;
    setCache(prev);
    onRestored();
  });

  await new Promise((r) => setTimeout(r, waitMs));
  if (undone) return;

  try {
    await deleteApi(d.id);
    await refresh();
  } catch {
    setCache(prev);
    onError();
  }
}
