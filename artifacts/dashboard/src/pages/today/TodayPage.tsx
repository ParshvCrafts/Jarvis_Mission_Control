import { useState } from "react";
import { Copy, Check, AlertTriangle, CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGetTodayView } from "@workspace/api-client-react";
import type {
  TodayFollowup,
  TodayReplySuggestion,
  TodayQueueItem,
  TodayBlocker,
  WeeklyGoal,
  SeasonAlert,
} from "@workspace/api-client-react";

// ─── Utilities ────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Inline copy-to-clipboard button with tick feedback */
function CopyBtn({ text, className }: { text: string; className?: string }) {
  const [done, setDone] = useState(false);
  async function handle() {
    await navigator.clipboard.writeText(text);
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  }
  return (
    <button
      onClick={handle}
      title="Copy to clipboard"
      className={cn(
        "p-1 rounded transition-colors shrink-0",
        done
          ? "text-emerald-400"
          : "text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800",
        className,
      )}
    >
      {done ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

/** Score badge for queue items */
function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <span
        className="inline-flex items-center rounded px-1.5 py-px text-[10px] font-mono text-zinc-600"
        title="No score data"
      >
        —
      </span>
    );
  }
  const cls =
    score >= 4
      ? "bg-emerald-950 text-emerald-300 ring-emerald-800"
      : score >= 3
        ? "bg-amber-950 text-amber-300 ring-amber-800"
        : "bg-red-950 text-red-300 ring-red-800";
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-px text-[10px] font-mono font-semibold ring-1 ring-inset ${cls}`}>
      {score.toFixed(1)}
    </span>
  );
}

/** Urgency chip */
const URGENCY_STYLE: Record<string, string> = {
  urgent: "bg-red-950 text-red-400 ring-red-800/60",
  overdue: "bg-orange-950 text-orange-400 ring-orange-800/60",
  "needs-data": "bg-purple-950 text-purple-400 ring-purple-800/60",
  waiting: "bg-zinc-900 text-zinc-500 ring-zinc-700/60",
  cold: "bg-blue-950 text-blue-400 ring-blue-800/60",
};

function UrgencyChip({ label }: { label: string }) {
  return (
    <span className={`text-[10px] font-mono px-1.5 py-px rounded ring-1 ring-inset ${URGENCY_STYLE[label] ?? URGENCY_STYLE.waiting}`}>
      {label}
    </span>
  );
}

/** Confidence chip */
const CONF_STYLE: Record<string, string> = {
  high: "text-emerald-400",
  medium: "text-amber-400",
  low: "text-zinc-500",
};

/** Empty state */
function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="py-3 text-center">
      <p className="text-xs text-zinc-700">{message}</p>
      {hint && (
        <code className="text-[10px] text-zinc-700 mt-1.5 bg-zinc-900 rounded px-2 py-1 block w-fit mx-auto">
          {hint}
        </code>
      )}
    </div>
  );
}

/** Card shell */
function Card({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-zinc-900/30 border border-zinc-800 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800/60">
        <h2 className="text-xs font-semibold text-zinc-300">{title}</h2>
        {typeof count === "number" && (
          <span className="text-[10px] font-mono text-zinc-600 bg-zinc-900 px-1.5 py-px rounded">
            {count}
          </span>
        )}
      </div>
      <div className="px-4 py-3 space-y-2">{children}</div>
    </div>
  );
}

// ─── Weekly goal bar ──────────────────────────────────────────────────────────

function WeeklyGoalBar({ goal }: { goal: WeeklyGoal }) {
  const pct = goal.target > 0
    ? Math.min(100, Math.round((goal.progress / goal.target) * 100))
    : 0;
  const done = goal.progress >= goal.target;
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] text-zinc-600">
          Applied this week (w/o {formatDate(goal.week_start)})
        </span>
        <span className={cn("text-[10px] font-mono", done ? "text-emerald-400" : "text-zinc-500")}>
          {goal.progress} / {goal.target}
        </span>
      </div>
      <div className="h-px bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-700", done ? "bg-emerald-500" : "bg-blue-600")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Follow-ups card ──────────────────────────────────────────────────────────

function FollowupsCard({ items }: { items: TodayFollowup[] }) {
  return (
    <Card title="Follow-ups" count={items.length}>
      {items.length === 0 ? (
        <EmptyState
          message="No follow-ups recorded."
          hint="python3.11 scripts/track.py followup <num> --urgency high --date YYYY-MM-DD"
        />
      ) : (
        items.map((f) => (
          <div
            key={f.id}
            className="flex items-start gap-3 py-2 border-b border-zinc-800/40 last:border-0"
          >
            <UrgencyChip label={f.urgency_label} />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-xs font-medium text-zinc-200">{f.company}</span>
                <span className="text-[11px] text-zinc-600">{f.role}</span>
              </div>
              {f.reason && (
                <p className="text-[11px] text-zinc-500 mt-0.5 truncate">{f.reason}</p>
              )}
            </div>
            <span className="text-[10px] font-mono text-zinc-700 shrink-0 mt-0.5">
              {f.next_date || "no date"}
            </span>
          </div>
        ))
      )}
    </Card>
  );
}

// ─── Reply suggestions card ───────────────────────────────────────────────────

function ReplySuggestionsCard({ items }: { items: TodayReplySuggestion[] }) {
  return (
    <Card title="Reply suggestions" count={items.length}>
      {items.length === 0 ? (
        <EmptyState message="No actionable reply suggestions from the last sync." />
      ) : (
        items.map((s) => (
          <div
            key={s.id}
            className="py-2 border-b border-zinc-800/40 last:border-0 space-y-1.5"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-mono text-zinc-600">{s.message_date}</span>
              <span className="text-xs font-medium text-zinc-200 truncate">{s.subject}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-zinc-500 truncate">{s.from_addr}</span>
              <span className="text-[10px] text-zinc-600 bg-zinc-800 px-1.5 py-px rounded">{s.kind}</span>
              <span className={cn("text-[10px] font-medium", CONF_STYLE[s.confidence] ?? "text-zinc-500")}>
                {s.confidence}
              </span>
            </div>
            <div className="flex items-center gap-2 bg-zinc-900 rounded px-2 py-1.5">
              <code className="flex-1 text-[10px] text-zinc-400 font-mono truncate">
                {s.suggested_command}
              </code>
              <CopyBtn text={s.suggested_command} />
            </div>
          </div>
        ))
      )}
    </Card>
  );
}

// ─── Queue card ───────────────────────────────────────────────────────────────

function QueueCard({ items }: { items: TodayQueueItem[] }) {
  return (
    <Card title="Review queue" count={items.length}>
      {items.length === 0 ? (
        <EmptyState
          message="No unreviewed queue items."
          hint="python3.11 scripts/track.py push"
        />
      ) : (
        items.map((q) => (
          <div
            key={q.id}
            className="flex items-center gap-3 py-2 border-b border-zinc-800/40 last:border-0"
          >
            <ScoreBadge score={q.score} />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-xs font-medium text-zinc-200">{q.company}</span>
                <span className="text-[11px] text-zinc-500 truncate">{q.title}</span>
              </div>
            </div>
            <span className="text-[10px] font-mono text-zinc-700 shrink-0">
              {q.posted_age_days}d old
            </span>
          </div>
        ))
      )}
    </Card>
  );
}

// ─── Blockers card ────────────────────────────────────────────────────────────

function BlockersCard({ items }: { items: TodayBlocker[] }) {
  return (
    <Card title="Blockers" count={items.length}>
      {items.length === 0 ? (
        <EmptyState message="No blockers across active applications." />
      ) : (
        items.map((b) => (
          <div
            key={b.num}
            className="py-2 border-b border-zinc-800/40 last:border-0"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-semibold text-zinc-200">{b.company}</span>
              <span className="text-[10px] text-zinc-600 font-medium">{b.status}</span>
            </div>
            <ul className="space-y-0.5">
              {b.blockers.map((blocker, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px]">
                  <span className="text-red-500 mt-0.5 shrink-0">✕</span>
                  <span className="text-red-300">{blocker}</span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </Card>
  );
}

// ─── Season alert banner ──────────────────────────────────────────────────────

function SeasonAlertBanner({ alert }: { alert: SeasonAlert }) {
  return (
    <div className="mt-2 flex items-center gap-2 text-xs text-blue-300 bg-blue-950/30 rounded px-3 py-1.5 border border-blue-900/50">
      <CalendarClock className="h-3.5 w-3.5 shrink-0 text-blue-400" />
      <span>
        <strong>{alert.company}</strong> — {alert.program}{" "}
        <span className="text-blue-400">{alert.kind === "opens" ? "opens" : "closes"}</span> on{" "}
        <span className="font-mono">{alert.date}</span>{" "}
        <span className="text-blue-600">(within 7 days)</span>
      </span>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TodayPage() {
  const { data, isLoading, isError } = useGetTodayView();

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ── */}
      <div className="px-5 py-3 border-b border-zinc-800 shrink-0">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-sm font-semibold text-zinc-100">Today</h1>
              {data && (
                <span className="text-[11px] font-mono text-zinc-600">
                  {data.today_date}
                  {data.last_sync_at
                    ? ` · sync ${relativeTime(data.last_sync_at)}`
                    : " · never synced"}
                </span>
              )}
            </div>
            {data?.season_alert && (
              <SeasonAlertBanner alert={data.season_alert} />
            )}
            {data?.weekly_goal && (
              <WeeklyGoalBar goal={data.weekly_goal} />
            )}
          </div>

          {data?.is_stale && (
            <div className="flex items-center gap-1.5 text-[11px] text-amber-400 bg-amber-950/50 ring-1 ring-amber-800/60 px-2.5 py-1 rounded shrink-0">
              <AlertTriangle className="h-3 w-3" />
              Sync overdue (48h+)
            </div>
          )}
        </div>
      </div>

      {/* ── Cards ── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isLoading && (
          <div className="flex items-center justify-center h-40 text-xs text-zinc-700 font-mono">
            Loading today view…
          </div>
        )}
        {isError && (
          <div className="flex items-center justify-center h-40 text-xs text-red-500">
            Failed to load. Check API server.
          </div>
        )}
        {data && (
          <>
            <FollowupsCard items={data.followups} />
            <ReplySuggestionsCard items={data.reply_suggestions} />
            <QueueCard items={data.queue_top} />
            <BlockersCard items={data.blockers} />
          </>
        )}
      </div>
    </div>
  );
}
