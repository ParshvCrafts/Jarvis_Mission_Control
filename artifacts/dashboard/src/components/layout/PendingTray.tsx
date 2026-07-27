import { ClipboardList, ChevronUp, ChevronDown, Copy, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePendingChanges } from "@/contexts/PendingChangesContext";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { PendingChange } from "@workspace/api-client-react";

// ─── State badge ──────────────────────────────────────────────────────────────

function StateBadge({ state }: { state: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    pending: { cls: "text-zinc-500 bg-zinc-900", label: "pending" },
    copied: { cls: "text-blue-400 bg-blue-950/60", label: "copied" },
    applied: { cls: "text-emerald-400 bg-emerald-950/60", label: "applied" },
  };
  const { cls, label } = map[state] ?? { cls: "text-zinc-600 bg-zinc-900", label: state };
  return (
    <span className={`text-[10px] font-mono px-1.5 py-px rounded ${cls}`}>
      {label}
    </span>
  );
}

// ─── Change row ───────────────────────────────────────────────────────────────

function ChangeRow({
  change,
  onCopy,
  onDismiss,
}: {
  change: PendingChange;
  onCopy: (c: PendingChange) => void;
  onDismiss: (id: number) => void;
}) {
  const kind = change.kind.replace("_", " ");

  return (
    <div className="flex items-start gap-2 py-2 border-b border-zinc-800/60 last:border-0">
      {/* Kind chip */}
      <span className="text-[10px] text-zinc-600 font-mono shrink-0 mt-0.5 w-20 truncate">
        #{change.num} {kind}
      </span>

      {/* Command */}
      <code className="flex-1 text-[10px] text-zinc-400 font-mono break-all leading-tight min-w-0">
        {change.command}
      </code>

      {/* State badge */}
      <StateBadge state={change.state} />

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        {change.state !== "applied" && (
          <button
            onClick={() => onCopy(change)}
            className="p-1 rounded text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
            title="Copy command"
          >
            {change.state === "copied" ? (
              <Check className="h-3 w-3 text-blue-400" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>
        )}
        <button
          onClick={() => onDismiss(change.id)}
          className="p-1 rounded text-zinc-700 hover:text-red-400 hover:bg-zinc-800 transition-colors"
          title="Dismiss"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ─── Pending tray ─────────────────────────────────────────────────────────────

export default function PendingTray() {
  const { changes, activeChanges, trayOpen, setTrayOpen, copyChange, copyAll, updateState } =
    usePendingChanges();

  const displayChanges = changes.filter((c) => c.state !== "dismissed");

  if (displayChanges.length === 0) return null;

  return (
    <Collapsible
      open={trayOpen}
      onOpenChange={setTrayOpen}
      className="border-t border-zinc-800 bg-zinc-950 shrink-0"
    >
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-2 px-4 py-2 w-full hover:bg-zinc-900/60 transition-colors group">
          <ClipboardList className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
          <span className="text-xs font-medium text-zinc-400">
            Pending changes
          </span>
          {activeChanges.length > 0 && (
            <span className="text-[10px] font-mono bg-amber-950 text-amber-400 ring-1 ring-amber-800/60 px-1.5 py-px rounded-full">
              {activeChanges.length}
            </span>
          )}
          <span className="ml-auto text-zinc-700 group-hover:text-zinc-500 transition-colors">
            {trayOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5" />
            )}
          </span>
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="max-h-48 overflow-y-auto px-4 pb-3">
          {/* Toolbar */}
          {activeChanges.length > 0 && (
            <div className="flex items-center justify-between py-2 mb-1 border-b border-zinc-800/60">
              <span className="text-[10px] text-zinc-600">
                {activeChanges.length} active · paste into terminal on Mac
              </span>
              <button
                onClick={copyAll}
                className={cn(
                  "flex items-center gap-1 text-[10px] px-2 py-1 rounded",
                  "bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200",
                  "border border-zinc-800 transition-colors",
                )}
              >
                <Copy className="h-2.5 w-2.5" />
                Copy all
              </button>
            </div>
          )}

          {/* Changes list */}
          {displayChanges.map((change) => (
            <ChangeRow
              key={change.id}
              change={change}
              onCopy={copyChange}
              onDismiss={(id) => updateState(id, "dismissed")}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
