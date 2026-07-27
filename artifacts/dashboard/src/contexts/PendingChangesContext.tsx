import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useListPendingChanges,
  useCreatePendingChange,
  useUpdatePendingChangeState,
  getListPendingChangesQueryKey,
  type PendingChange,
  type CreatePendingChangeRequest,
} from "@workspace/api-client-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PendingChangesContextValue {
  /** All non-dismissed changes (newest first) */
  changes: PendingChange[];
  /** Active (pending | copied) changes */
  activeChanges: PendingChange[];
  isLoading: boolean;
  /** Most recent active (pending|copied) change for a given app num, or null */
  getActiveChange: (num: number) => PendingChange | null;
  /** Create a new pending change; invalidates the list */
  createChange: (req: CreatePendingChangeRequest) => Promise<PendingChange>;
  /** Update the state of an existing change */
  updateState: (id: number, state: "copied" | "applied" | "dismissed") => Promise<void>;
  /** Copy command to clipboard and advance state to 'copied' */
  copyChange: (change: PendingChange) => Promise<void>;
  /** Copy all active commands to clipboard; advance pending → copied */
  copyAll: () => Promise<void>;
  /** Whether the tray is expanded */
  trayOpen: boolean;
  setTrayOpen: (v: boolean) => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const PendingChangesContext = createContext<PendingChangesContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function PendingChangesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const [trayOpen, setTrayOpen] = useState(false);

  // ── Data ─────────────────────────────────────────────────────────────────
  const { data, isLoading } = useListPendingChanges();

  const changes = (data?.changes ?? []).filter(
    (c) => c.state !== "dismissed",
  );
  const activeChanges = changes.filter(
    (c) => c.state === "pending" || c.state === "copied",
  );

  // Auto-open the tray when new active changes appear
  const prevActiveCount = useRef(activeChanges.length);
  useEffect(() => {
    if (activeChanges.length > prevActiveCount.current) {
      setTrayOpen(true);
    }
    prevActiveCount.current = activeChanges.length;
  }, [activeChanges.length]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/pending-changes"] });
  }, [queryClient]);

  const createMutation = useCreatePendingChange({
    mutation: { onSuccess: invalidate },
  });

  const updateMutation = useUpdatePendingChangeState({
    mutation: { onSuccess: invalidate },
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  const getActiveChange = useCallback(
    (num: number): PendingChange | null =>
      activeChanges.find((c) => c.num === num) ?? null,
    [activeChanges],
  );

  const createChange = useCallback(
    async (req: CreatePendingChangeRequest): Promise<PendingChange> => {
      const result = await createMutation.mutateAsync({ data: req });
      return result.change;
    },
    [createMutation],
  );

  const updateState = useCallback(
    async (
      id: number,
      state: "copied" | "applied" | "dismissed",
    ): Promise<void> => {
      await updateMutation.mutateAsync({ id, data: { state } });
    },
    [updateMutation],
  );

  const copyChange = useCallback(
    async (change: PendingChange): Promise<void> => {
      await navigator.clipboard.writeText(change.command);
      if (change.state === "pending") {
        await updateState(change.id, "copied");
      }
      toast.success("Copied to clipboard", {
        description: change.command.slice(0, 60) + (change.command.length > 60 ? "…" : ""),
        duration: 2500,
      });
    },
    [updateState],
  );

  const copyAll = useCallback(async (): Promise<void> => {
    if (activeChanges.length === 0) return;
    const text = activeChanges.map((c) => c.command).join("\n");
    await navigator.clipboard.writeText(text);
    for (const c of activeChanges) {
      if (c.state === "pending") {
        await updateState(c.id, "copied");
      }
    }
    toast.success(
      `${activeChanges.length} command${activeChanges.length === 1 ? "" : "s"} copied`,
    );
  }, [activeChanges, updateState]);

  return (
    <PendingChangesContext.Provider
      value={{
        changes,
        activeChanges,
        isLoading,
        getActiveChange,
        createChange,
        updateState,
        copyChange,
        copyAll,
        trayOpen,
        setTrayOpen,
      }}
    >
      {children}
    </PendingChangesContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePendingChanges(): PendingChangesContextValue {
  const ctx = useContext(PendingChangesContext);
  if (!ctx) {
    throw new Error(
      "usePendingChanges must be used inside PendingChangesProvider",
    );
  }
  return ctx;
}
