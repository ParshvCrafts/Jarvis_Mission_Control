import { useState, useEffect, useRef, useCallback } from "react";
import { ExternalLink, Check, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListQueueItems,
  useSetQueueItemReviewed,
  getListQueueItemsQueryKey,
} from "@workspace/api-client-react";
import type { QueueItemRow, ListQueueItemsParams } from "@workspace/api-client-react";

const PAGE_SIZE = 50;

// ── Score badge ───────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <span
        className="inline-flex items-center rounded px-1.5 py-px text-[10px] font-mono shrink-0 w-10 justify-center text-zinc-600"
        title="No score data"
      >
        —
      </span>
    );
  }
  const cls =
    score >= 80
      ? "bg-emerald-950 text-emerald-300 ring-emerald-800"
      : score >= 60
        ? "bg-amber-950 text-amber-300 ring-amber-800"
        : "bg-red-950 text-red-300 ring-red-800";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-px text-[10px] font-mono font-semibold ring-1 ring-inset shrink-0 w-10 justify-center",
        cls,
      )}
    >
      {score.toFixed(1)}
    </span>
  );
}

// ── Queue row ─────────────────────────────────────────────────────────────────

interface RowProps {
  item: QueueItemRow;
  isFocused: boolean;
  onFocus: () => void;
  onToggleReviewed: () => void;
}

function QueueRow({ item, isFocused, onFocus, onToggleReviewed }: RowProps) {
  const isStale = item.posted_age_days > 60;

  return (
    <div
      onClick={onFocus}
      className={cn(
        "flex items-center gap-3 px-5 py-2 border-b border-zinc-800/40 cursor-pointer transition-colors select-none",
        isFocused ? "bg-zinc-800/70" : "hover:bg-zinc-900/60",
        item.reviewed ? "opacity-40" : "",
      )}
    >
      {/* Focus bar */}
      <span
        className={cn(
          "w-0.5 h-4 rounded-full shrink-0 -ml-1.5 transition-colors",
          isFocused ? "bg-blue-500" : "bg-transparent",
        )}
      />

      <ScoreBadge score={item.score} />

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "text-xs font-medium shrink-0",
              item.reviewed ? "text-zinc-500" : "text-zinc-100",
            )}
          >
            {item.company}
          </span>
          <span
            className={cn(
              "text-[11px] truncate",
              item.reviewed ? "text-zinc-700" : "text-zinc-500",
            )}
          >
            {item.title}
          </span>
        </div>
      </div>

      <span
        className={cn(
          "text-[10px] font-mono shrink-0 w-14 text-right",
          isStale ? "text-orange-600/80" : "text-zinc-700",
        )}
        title={item.posted}
      >
        {item.posted_age_days}d old
      </span>

      {item.reviewed ? (
        <Check className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
      ) : (
        <span className="h-3.5 w-3.5 shrink-0" />
      )}

      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        title="Open in new tab (o)"
        className="text-zinc-700 hover:text-zinc-300 transition-colors shrink-0"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </a>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleReviewed();
        }}
        title={item.reviewed ? "Mark unreviewed" : "Mark reviewed (r)"}
        className={cn(
          "text-[10px] font-mono px-2 py-0.5 rounded border transition-colors shrink-0 w-10 text-center",
          item.reviewed
            ? "border-zinc-800 text-zinc-600 hover:border-zinc-600 hover:text-zinc-400"
            : "border-zinc-700 text-zinc-500 hover:border-emerald-700 hover:text-emerald-400",
        )}
      >
        {item.reviewed ? "↩" : "r"}
      </button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function QueuePage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"unreviewed" | "all">("unreviewed");
  const [company, setCompany] = useState("");
  const [sort, setSort] = useState<"rank" | "score">("score");
  const [page, setPage] = useState(1);
  const [focusedIdx, setFocusedIdx] = useState(0);

  const companyInputRef = useRef<HTMLInputElement>(null);

  // Row elements — kept in sync with rendered items for scrolling
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  const params: ListQueueItemsParams = {
    filter,
    ...(company ? { company } : {}),
    sort,
    page,
    page_size: PAGE_SIZE,
  };

  const { data, isLoading } = useListQueueItems(params);

  const { mutate: setReviewed } = useSetQueueItemReviewed({
    mutation: {
      onSuccess: (result) => {
        // Optimistically update this item in all matching caches
        const queryKey = getListQueueItemsQueryKey(params);
        queryClient.setQueryData(queryKey, (old: typeof data) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((it) =>
              it.id === result.item.id ? result.item : it,
            ),
          };
        });
        // Also refetch to get accurate total counts
        queryClient.invalidateQueries({ queryKey: ["/api/queue"] });
      },
    },
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Reset focus when filters change
  useEffect(() => {
    setFocusedIdx(0);
    rowRefs.current = [];
  }, [filter, company, sort, page]);

  // Scroll focused row into view
  useEffect(() => {
    rowRefs.current[focusedIdx]?.scrollIntoView({ block: "nearest" });
  }, [focusedIdx]);

  const handleToggleReviewed = useCallback(
    (idx: number) => {
      const item = items[idx];
      if (!item) return;
      setReviewed({ id: item.id, data: { reviewed: !item.reviewed } });
      // When marking reviewed in the unreviewed view, advance focus to the next item
      if (!item.reviewed && filter === "unreviewed") {
        setFocusedIdx((prev) => Math.max(0, Math.min(prev, items.length - 2)));
      }
    },
    [items, filter, setReviewed],
  );

  // Global keyboard handler — disabled when typing in the company input
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (document.activeElement === companyInputRef.current) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case "j":
          e.preventDefault();
          setFocusedIdx((i) => Math.min(i + 1, items.length - 1));
          break;
        case "k":
          e.preventDefault();
          setFocusedIdx((i) => Math.max(i - 1, 0));
          break;
        case "r":
          e.preventDefault();
          handleToggleReviewed(focusedIdx);
          break;
        case "o": {
          e.preventDefault();
          const item = items[focusedIdx];
          if (item?.url) window.open(item.url, "_blank", "noopener,noreferrer");
          break;
        }
      }
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [items, focusedIdx, handleToggleReviewed]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ── */}
      <div className="px-5 py-2.5 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-sm font-semibold text-zinc-100">Queue</h1>

          {/* Filter toggle */}
          <div className="flex rounded overflow-hidden border border-zinc-800 text-[11px]">
            {(["unreviewed", "all"] as const).map((f) => (
              <button
                key={f}
                onClick={() => {
                  setFilter(f);
                  setPage(1);
                }}
                className={cn(
                  "px-2.5 py-1 transition-colors font-medium",
                  filter === f
                    ? "bg-zinc-800 text-zinc-100"
                    : "text-zinc-600 hover:text-zinc-300",
                )}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Sort toggle */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-zinc-700">sort</span>
            <div className="flex rounded overflow-hidden border border-zinc-800 text-[11px]">
              {(["score", "rank"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setSort(s);
                    setPage(1);
                  }}
                  className={cn(
                    "px-2.5 py-1 transition-colors font-medium",
                    sort === s
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-600 hover:text-zinc-300",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Company search */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-700 pointer-events-none" />
            <input
              ref={companyInputRef}
              value={company}
              onChange={(e) => {
                setCompany(e.target.value);
                setPage(1);
              }}
              placeholder="company…"
              className="bg-zinc-900 border border-zinc-800 rounded pl-6 pr-2.5 py-1 text-[11px] text-zinc-300 placeholder:text-zinc-700 w-28 focus:outline-none focus:border-zinc-600 transition-colors"
            />
          </div>

          <span className="text-[11px] text-zinc-700 ml-auto">
            {isLoading ? (
              "…"
            ) : (
              <>
                <span className="text-zinc-500">{total}</span> item
                {total !== 1 ? "s" : ""}
                {total > 0 && (
                  <span className="ml-2 text-zinc-800">
                    j/k · r review · o open
                  </span>
                )}
              </>
            )}
          </span>
        </div>
      </div>

      {/* ── Column headers ── */}
      {!isLoading && items.length > 0 && (
        <div className="flex items-center gap-3 px-5 py-1 border-b border-zinc-800/60 shrink-0">
          <span className="w-0.5 -ml-1.5 shrink-0" />
          <span className="w-10 shrink-0 text-[10px] text-zinc-700 font-mono">score</span>
          <span className="flex-1 text-[10px] text-zinc-700">company / title</span>
          <span className="w-14 text-right text-[10px] text-zinc-700">age</span>
          <span className="h-3.5 w-3.5 shrink-0" />
          <span className="h-3.5 w-3.5 shrink-0" />
          <span className="w-10 shrink-0" />
        </div>
      )}

      {/* ── List ── */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center h-40 text-xs text-zinc-700 font-mono">
            Loading…
          </div>
        )}

        {!isLoading && items.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <p className="text-xs text-zinc-600">
              {filter === "unreviewed"
                ? "All items reviewed — nice work."
                : "No queue items yet. Run a sync from the Mac to populate."}
            </p>
            {filter === "unreviewed" && total === 0 && (
              <button
                onClick={() => setFilter("all")}
                className="text-[11px] text-zinc-500 hover:text-zinc-300 underline underline-offset-2 transition-colors"
              >
                Show all items
              </button>
            )}
          </div>
        )}

        {items.map((item, idx) => (
          <div
            key={item.id}
            ref={(el) => {
              rowRefs.current[idx] = el;
            }}
          >
            <QueueRow
              item={item}
              isFocused={idx === focusedIdx}
              onFocus={() => setFocusedIdx(idx)}
              onToggleReviewed={() => handleToggleReviewed(idx)}
            />
          </div>
        ))}
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="px-5 py-2 border-t border-zinc-800 shrink-0 flex items-center gap-3">
          <button
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
            className="disabled:opacity-25 text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-[11px] text-zinc-600 font-mono">
            {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="disabled:opacity-25 text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="text-[10px] text-zinc-700 ml-1">
            ({(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total})
          </span>
        </div>
      )}
    </div>
  );
}
