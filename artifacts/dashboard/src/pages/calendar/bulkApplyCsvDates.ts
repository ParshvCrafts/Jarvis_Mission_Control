// Bulk "Use all CSV dates" flow with undo, extracted from CalendarPage so it
// can be unit-tested (mirrors the optimisticDelete.ts pattern). Each conflict
// row's dates are overwritten with the CSV's dates; a toast then offers Undo
// for UNDO_WINDOW_MS. Undo writes each successfully-updated row's PREVIOUS
// opens/closes dates back via the same update API, so the restore is durable
// (survives refetches). Rows that failed during the bulk run are untouched by
// Undo — only rows that were actually changed get restored.

export { UNDO_WINDOW_MS } from "./optimisticDelete";

export interface BulkConflictRow {
  existing_id: number;
  company: string;
  existing_opens_date: string | null;
  existing_closes_date: string | null;
  csv_opens_date: string | null;
  csv_closes_date: string | null;
}

export interface BulkApplyDeps<T extends BulkConflictRow> {
  /** Update a deadline's dates server-side. */
  applyApi: (id: number, dates: { opens_date: string | null; closes_date: string | null }) => Promise<unknown>;
  /** Called as each row is applied (remove it from the conflict panel). */
  onRowApplied: (row: T) => void;
  /** Called for each row restored by Undo (re-add it to the conflict panel). */
  onRowRestored: (row: T) => void;
  /** Refetch/invalidate the deadlines list. */
  refresh: () => Promise<void>;
  /**
   * Show the result toast. When `onUndo` is non-null at least one row was
   * updated and the toast should offer an Undo action for UNDO_WINDOW_MS.
   * `failed` lists rows that could not be updated.
   */
  showResultToast: (ok: number, failed: T[], onUndo: (() => void) | null) => void;
  /** Called after Undo finishes: how many rows were restored vs failed to restore. */
  onUndone: (restored: number, failedRestores: T[]) => void;
}

export async function runBulkApplyCsvDates<T extends BulkConflictRow>(
  rows: T[],
  deps: BulkApplyDeps<T>,
): Promise<void> {
  const { applyApi, onRowApplied, onRowRestored, refresh, showResultToast, onUndone } = deps;

  const succeeded: T[] = [];
  const failed: T[] = [];
  for (const row of rows) {
    try {
      await applyApi(row.existing_id, {
        opens_date: row.csv_opens_date,
        closes_date: row.csv_closes_date,
      });
      succeeded.push(row);
      onRowApplied(row);
    } catch {
      failed.push(row);
    }
  }
  await refresh();

  if (succeeded.length === 0) {
    showResultToast(0, failed, null);
    return;
  }

  let undone = false;
  const onUndo = () => {
    if (undone) return;
    undone = true;
    void (async () => {
      let restored = 0;
      const failedRestores: T[] = [];
      for (const row of succeeded) {
        try {
          await applyApi(row.existing_id, {
            opens_date: row.existing_opens_date,
            closes_date: row.existing_closes_date,
          });
          restored++;
          // Put the row back in the conflict panel so the user can re-decide.
          onRowRestored(row);
        } catch {
          failedRestores.push(row);
        }
      }
      await refresh();
      onUndone(restored, failedRestores);
    })();
  };

  showResultToast(succeeded.length, failed, onUndo);
}
