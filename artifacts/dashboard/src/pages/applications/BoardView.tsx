import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { usePendingChanges } from "@/contexts/PendingChangesContext";
import { formatPendingCommand, todayLA } from "@/lib/pendingCommands";
import {
  isAllowedTransition,
  TERMINAL_STATUSES,
  BOARD_PIPELINE_COLS,
  BOARD_EXIT_COLS,
} from "@/lib/transitions";
import type { ApplicationRow, PendingChange } from "@workspace/api-client-react";

// ─── Score badge ──────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: string }) {
  const n = parseFloat(score);
  if (!score || isNaN(n)) return null;
  const cls =
    n >= 4
      ? "bg-emerald-950 text-emerald-300 ring-emerald-800"
      : n >= 3
        ? "bg-amber-950 text-amber-300 ring-amber-800"
        : "bg-red-950 text-red-300 ring-red-800";
  return (
    <span
      className={`inline-flex items-center rounded px-1 py-px text-[10px] font-mono font-semibold ring-1 ring-inset ${cls}`}
    >
      {n.toFixed(1)}
    </span>
  );
}

// ─── Card content ─────────────────────────────────────────────────────────────

function CardContent({
  app,
  activeChange,
  floating = false,
}: {
  app: ApplicationRow;
  activeChange: PendingChange | null;
  floating?: boolean;
}) {
  const isPending = !!activeChange;
  return (
    <div
      className={cn(
        "bg-zinc-900 border rounded-md p-3 text-xs select-none",
        floating
          ? "border-blue-500/60 shadow-xl shadow-black/40 opacity-95"
          : "border-zinc-800 hover:border-zinc-700 transition-colors",
      )}
    >
      <div className="flex items-start justify-between gap-1 mb-1">
        <p className="font-semibold text-zinc-100 text-[13px] truncate leading-tight">
          {app.company}
        </p>
        <ScoreBadge score={app.score} />
      </div>
      <p className="text-zinc-500 truncate mb-2 leading-tight">{app.role}</p>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="font-mono text-zinc-600">{app.days_in_stage}d</span>
        {app.has_ghost_flag && <span title="No activity in 21+ days">👻</span>}
        {isPending && (
          <span className="text-[10px] text-amber-400 bg-amber-950/80 px-1 py-px rounded ring-1 ring-amber-800/60">
            ~pending
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Draggable card ───────────────────────────────────────────────────────────

function DraggableCard({
  app,
  activeChange,
  isTerminal,
}: {
  app: ApplicationRow;
  activeChange: PendingChange | null;
  isTerminal: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: app.num, disabled: isTerminal });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(
        "touch-none",
        isTerminal ? "cursor-default" : "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-30",
      )}
      {...(isTerminal ? {} : { ...listeners, ...attributes })}
    >
      <CardContent app={app} activeChange={activeChange} />
    </div>
  );
}

// ─── Column ───────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  evaluated: "Evaluated",
  applied: "Applied",
  oa: "OA",
  responded: "Responded",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
  discarded: "Discarded",
  withdrawn: "Withdrawn",
};

const STATUS_DOT: Record<string, string> = {
  evaluated: "bg-blue-500",
  applied: "bg-yellow-500",
  oa: "bg-orange-500",
  responded: "bg-teal-500",
  interview: "bg-emerald-500",
  offer: "bg-green-500",
  hired: "bg-green-400",
  rejected: "bg-red-500",
  discarded: "bg-zinc-500",
  withdrawn: "bg-zinc-500",
};

function KanbanColumn({
  status,
  apps,
  getActiveChange,
  isTerminal = false,
}: {
  status: string;
  apps: ApplicationRow[];
  getActiveChange: (n: number) => PendingChange | null;
  isTerminal?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div className="flex flex-col shrink-0 w-48">
      {/* Column header */}
      <div className="flex items-center gap-2 mb-2 px-0.5">
        <div
          className={cn(
            "h-2 w-2 rounded-full shrink-0",
            STATUS_DOT[status] ?? "bg-zinc-500",
          )}
        />
        <span className="text-xs font-medium text-zinc-400">
          {STATUS_LABELS[status] ?? status}
        </span>
        <span className="text-[10px] font-mono text-zinc-700 ml-auto">
          {apps.length}
        </span>
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 min-h-20 rounded-md border transition-colors duration-100 p-1.5 space-y-2",
          isOver
            ? "border-blue-500/40 bg-blue-950/10"
            : "border-zinc-800/40 bg-zinc-900/30",
        )}
      >
        {apps.map((app) => (
          <DraggableCard
            key={app.num}
            app={app}
            activeChange={getActiveChange(app.num)}
            isTerminal={isTerminal}
          />
        ))}
        {apps.length === 0 && (
          <div className="h-full flex items-center justify-center text-[10px] text-zinc-800 py-4">
            empty
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Terminal section (collapsed by default) ──────────────────────────────────

function TerminalSection({
  apps,
  getActiveChange,
}: {
  apps: ApplicationRow[];
  getActiveChange: (n: number) => PendingChange | null;
}) {
  const [expanded, setExpanded] = useState(false);

  /** Effective status respects pending overlay, same as BoardView.effectiveStatus */
  function getEffectiveStatus(app: ApplicationRow): string {
    const change = getActiveChange(app.num);
    if (change?.kind === "status") {
      const t = change.payload["target_status"];
      if (typeof t === "string") return t;
    }
    return app.status;
  }

  return (
    <div className="shrink-0">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-400 transition-colors mb-2 px-0.5"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <span>Terminal</span>
        <span className="font-mono text-zinc-700">({apps.length})</span>
      </button>

      {expanded && (
        <div className="flex gap-3">
          {BOARD_EXIT_COLS.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              apps={apps.filter((a) => getEffectiveStatus(a) === status)}
              getActiveChange={getActiveChange}
              isTerminal
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Board view ───────────────────────────────────────────────────────────────

export default function BoardView({ apps }: { apps: ApplicationRow[] }) {
  const { getActiveChange, createChange } = usePendingChanges();
  const [activeId, setActiveId] = useState<number | null>(null);

  /** Effective status (pending override if active change exists) */
  function effectiveStatus(app: ApplicationRow): string {
    const change = getActiveChange(app.num);
    if (change?.kind === "status") {
      const t = change.payload["target_status"];
      if (typeof t === "string") return t;
    }
    return app.status;
  }

  const activeApp = apps.find((a) => a.num === activeId) ?? null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as number);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const num = active.id as number;
    const targetStatus = String(over.id);
    const app = apps.find((a) => a.num === num);
    if (!app) return;

    const fromStatus = effectiveStatus(app);
    if (fromStatus === targetStatus) return;

    if (!isAllowedTransition(fromStatus, targetStatus)) {
      toast.error(
        "Backward/terminal corrections happen on the Mac with --force",
        {
          description: `${fromStatus} → ${targetStatus} is not a valid forward transition.`,
          duration: 4000,
        },
      );
      return;
    }

    const cmd = formatPendingCommand("status", num, targetStatus, todayLA());

    try {
      await createChange({
        num,
        kind: "status",
        payload: { target_status: targetStatus },
        command: cmd,
      });
      toast.success(`${app.company} → ${targetStatus}`, {
        description: "Added to pending tray",
        duration: 2000,
      });
    } catch {
      toast.error("Failed to stage change");
    }
  }

  const terminalApps = apps.filter((a) =>
    TERMINAL_STATUSES.has(effectiveStatus(a)),
  );

  return (
    <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex gap-3 p-4 h-full overflow-x-auto overflow-y-auto items-start">
        {/* Pipeline columns */}
        {BOARD_PIPELINE_COLS.map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            apps={apps.filter(
              (a) =>
                effectiveStatus(a) === status &&
                !TERMINAL_STATUSES.has(a.status),
            )}
            getActiveChange={getActiveChange}
            isTerminal={status === "hired"}
          />
        ))}

        {/* Divider */}
        <div className="h-full w-px bg-zinc-800/60 shrink-0 mx-1 self-stretch" />

        {/* Terminal / exit columns */}
        <TerminalSection apps={terminalApps} getActiveChange={getActiveChange} />
      </div>

      <DragOverlay dropAnimation={null}>
        {activeApp && (
          <CardContent
            app={activeApp}
            activeChange={getActiveChange(activeApp.num)}
            floating
          />
        )}
      </DragOverlay>
    </DndContext>
  );
}
