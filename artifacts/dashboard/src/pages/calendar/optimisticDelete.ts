// Optimistic delete-with-undo flow, extracted from CalendarPage so it can be
// unit-tested. The item is removed from the cache immediately, an undo toast
// is shown for UNDO_WINDOW_MS; if the user hits Undo the cache is restored and
// the API call is skipped, otherwise the delete API runs. On API failure the
// cache is rolled back and an error is surfaced.
//
// If Undo arrives AFTER the delete API has already fired (e.g. the toast was
// hover-paused past the commit delay), a cache-only restore would be lost on
// the next refetch — the server no longer has the row. In that case Undo
// re-creates the item server-side via `recreateApi` so the restore is durable.

export const UNDO_WINDOW_MS = 5000;
/** Small buffer past the toast duration before committing the delete. */
export const COMMIT_DELAY_MS = UNDO_WINDOW_MS + 200;

export interface OptimisticDeleteDeps<T extends { id: number }> {
  /** Snapshot of the current list (taken before removal). */
  prev: T[];
  /** Read the current deadlines list from the query cache. */
  getCache: () => T[];
  /** Write the deadlines list into the query cache. */
  setCache: (items: T[]) => void;
  /** Show the "Deleted: X" toast with an Undo action. */
  showUndoToast: (onUndo: () => void) => void;
  /** Called after Undo restores the item. */
  onRestored: () => void;
  /** Called when the delete API fails (after rollback). */
  onError: () => void;
  /** Called when a post-commit Undo fails to re-create the item server-side. */
  onRestoreError: () => void;
  /** Perform the actual delete API call. */
  deleteApi: (id: number) => Promise<unknown>;
  /** Re-create the item server-side (used when Undo arrives after the delete committed). */
  recreateApi: (item: T) => Promise<unknown>;
  /** Refetch/invalidate after a successful delete or a durable restore. */
  refresh: () => Promise<void>;
  /** Delay before committing; injectable for tests. */
  waitMs?: number;
}

export async function runOptimisticDelete<T extends { id: number }>(
  d: T,
  deps: OptimisticDeleteDeps<T>,
): Promise<void> {
  const {
    prev,
    getCache,
    setCache,
    showUndoToast,
    onRestored,
    onError,
    onRestoreError,
    deleteApi,
    recreateApi,
    refresh,
  } = deps;
  const waitMs = deps.waitMs ?? COMMIT_DELAY_MS;

  // Index the item held in the snapshot so a restore can put it back where it
  // was, without clobbering other concurrent deletes.
  const originalIndex = prev.findIndex((x) => x.id === d.id);

  // Re-insert ONLY this item into the *current* cache (not the whole `prev`
  // snapshot). Restoring the snapshot would resurrect other items that were
  // optimistically deleted after this one.
  const restoreItem = () => {
    const current = getCache();
    if (current.some((x) => x.id === d.id)) return; // already present
    const next = [...current];
    const idx = originalIndex < 0 ? next.length : Math.min(originalIndex, next.length);
    next.splice(idx, 0, d);
    setCache(next);
  };

  // Optimistically remove the item.
  setCache(getCache().filter((x) => x.id !== d.id));

  let undone = false;
  // Set once the delete API call has been dispatched. Resolves to true when
  // the delete committed server-side, false when it failed (and rolled back).
  let deletePromise: Promise<boolean> | null = null;

  showUndoToast(() => {
    if (undone) return;
    undone = true;

    if (!deletePromise) {
      // Delete not sent yet — a cache restore is enough; the server still has
      // the row, so a refetch keeps it.
      restoreItem();
      onRestored();
      return;
    }

    // Delete already dispatched — wait for its outcome, then re-create
    // server-side if it committed, so the restore survives refetches.
    restoreItem();
    void deletePromise.then(async (committed) => {
      if (!committed) {
        // Delete failed; the row still exists server-side.
        onRestored();
        return;
      }
      try {
        await recreateApi(d);
        await refresh();
        onRestored();
      } catch {
        onRestoreError();
      }
    });
  });

  await new Promise((r) => setTimeout(r, waitMs));
  if (undone) return;

  deletePromise = (async () => {
    try {
      await deleteApi(d.id);
      if (!undone) await refresh();
      return true;
    } catch {
      if (!undone) {
        restoreItem();
        onError();
      }
      return false;
    }
  })();
  await deletePromise;
}
